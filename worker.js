const puppeteer = require('puppeteer');
const { PDFDocument, rgb } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);


require('dotenv').config();

class PdfWorker {

    constructor(pdfDir, logger) {

        this.pdfId = uuidv4();

        this.logger = logger

        this.pdfDir = pdfDir;
        this.configDir = path.join(this.pdfDir, 'config');
        this.recipePath = path.join(this.configDir, 'recipe.toml');
        this.filePath = path.join(this.pdfDir, `${this.pdfId}.pdf`);
        this.outputPath = path.join(this.pdfDir, `${this.pdfId}_out.pdf`);
        this.tocPath = path.join(this.pdfDir, `${this.pdfId}_toc.txt`);
    }

    async generatePdf(task_id, taskData, template_name, trackerData) {
        
        const totalStartTime = performance.now();

        this.logger.info(`PDF,${this.pdfId},Start`);

        let browser = null;
        let pdfBuffer = null;

        if (!process.env.CBM_BASE_URL) {
            throw new Error('CBM_BASE_URL environment variable is required');
        }
        if (!process.env.CBM_API_KEY) {
            throw new Error('CBM_API_KEY environment variable is required');
        }

        // Decode base64 credentials
        const decoded = Buffer.from(process.env.CBM_API_KEY, 'base64').toString();
        const [username, password] = decoded.split(':');

        if (!username || !password) {
            throw new Error('Invalid CBM_API_KEY format. Expected base64 encoded username:password');
        }
        
        try {
            const convertStartTime = performance.now();
            browser = await puppeteer.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                executablePath: '/usr/bin/google-chrome',
                headless: true
            });
            const page = await browser.newPage();
            
            await page.goto(`${process.env.CBM_BASE_URL}/login.spr`, { waitUntil: 'networkidle2' });
            await page.type('#user', username);
            await page.type('#password', password);
            await page.keyboard.press('Enter');
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            
            const params = new URLSearchParams({
                task_id: task_id
            });
            
            if (template_name?.trim()) {
                params.append('template_name', template_name.trim());
            }
            
            const preview_url = `${process.env.CBM_BASE_URL}/dtas/preview.spr?${params.toString()}`;
            
            await page.goto(preview_url, { waitUntil: 'networkidle2' });

            // Check page title matches task name
            await page.waitForSelector('title');
            const pageTitle = await page.title();
            if (pageTitle !== taskData.name) {
                console.error(`Title mismatch - Expected: "${taskData.name}", Got: "${pageTitle}"`);
                throw new Error('Page title does not match task name');
            }
            this.logger.info(`PDF,${this.pdfId},Title verified "${pageTitle}"`);
            
            // header of page
            const headerTemplate = `
                <div style="font-size: 10px; width: 100%; text-align: center; vertical-align: bottom; padding: 20px 0px;">
                    <span>${trackerData.description}</span>
                </div>
            `;

            // footer of page
            const footerTemplate = `
                <div style="font-size: 10px; width: 100%; text-align: center;">
                    <table style="width: 100%; padding: 0px 50px;">
                        <tr>
                            <td style="text-align: left; width: 30%;">@ copyright</td>
                            <td style="text-align: center; vertical-align: top;"><span class="title"></span></td>
                            <td style="text-align: right; width: 30%; vertical-align: top;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></td>
                        </tr>
                    </table>
                </div>
            `;

            pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: false,
                displayHeaderFooter: true,
                headerTemplate,
                footerTemplate,
                margin: { 
                    top: '70px',
                    right: '50px', // 注意：调整这里的参数，需要重新生成 recipe.toml
                    bottom: '70px',
                    left: '50px' // 注意：调整这里的参数，需要重新生成 recipe.toml
                },
            });

            const convertEndTime = performance.now();
            const convertTimeMs = convertEndTime - convertStartTime;
            this.logger.info(`PDF,${this.pdfId},PDF convert took: ${(convertTimeMs / 1000).toFixed(2)} seconds`);

            await fs.writeFile(this.filePath, pdfBuffer);

            try {
                // generate TOC
                const tocStartTime = performance.now();
                await execPromise(`pdftocgen "${this.filePath}" < "${this.recipePath}" > ${this.tocPath}`);
                await execPromise(`pdftocgen "${this.filePath}" < "${this.recipePath}" | pdftocio "${this.filePath}"`);
                const pdfWithToc = await fs.readFile(this.outputPath);

                const tocEndTime = performance.now();
                const tocTimeMs = tocEndTime - tocStartTime;
                this.logger.info(`PDF,${this.pdfId},TOC generation took: ${(tocTimeMs / 1000).toFixed(2)} seconds`);

                // generate TOC page
                const tocPdfBuffer = await this.#generateTocPage(browser, this.tocPath);

                // Merge
                const mergeStartTime = performance.now();
                // Load both PDFs
                const mainDoc = await PDFDocument.load(pdfWithToc);
                const tocDoc = await PDFDocument.load(tocPdfBuffer);

                // Copy pages from TOC document
                const tocPages = await mainDoc.copyPages(tocDoc, tocDoc.getPageIndices());

                tocPages.reverse();
                
                // Insert TOC pages at the beginning
                for (const page of tocPages) {
                    mainDoc.insertPage(0, page);
                }
                
                // Save merged PDF
                const finalPdfBytes = await mainDoc.save();

                const mergeEndTime = performance.now();
                const mergeTimeMs = mergeEndTime - mergeStartTime;
                this.logger.info(`PDF,${this.pdfId},Merge generation took: ${(mergeTimeMs / 1000).toFixed(2)} seconds`);

                return Buffer.from(finalPdfBytes);

            } catch (error) {
                this.logger.error(`PDF,${this.pdfId},TOC generation error: ${error}`)
                return pdfBuffer; // Return original if TOC generation fails
            } finally {
                // Cleanup temporary files
                try {
                    await fs.unlink(this.filePath);
                    await fs.unlink(this.outputPath);
                    await fs.unlink(this.tocPath);
                } catch (err) {
                    console.error('Cleanup error:', err);
                }
            }

        } finally {
            if (browser) {
                await browser.close();
            }
            const totalEndTime = performance.now();
            const totalTimeMs = totalEndTime - totalStartTime;
            this.logger.info(`PDF,${this.pdfId},Total generation took: ${(totalTimeMs / 1000).toFixed(2)} seconds`);
        }
    }

    async #generateTocPage(browser, tocPath){
        const tocPageStartTime = performance.now();
        // Read TOC contents
        const tocContent = await fs.readFile(tocPath, 'utf-8');
        const tocHtml = `
        <!DOCTYPE html>
        <html>
        <head>
        <style>
        .toc-title {
            text-align: center;
            font-size: 24px;
            font-weight: bold;
            margin: 20px 0 30px 0;
        }
        .toc-entry {
            display: flex;
            align-items: baseline;
            margin: 4px 0;
            overflow: hidden;
        }
        .title {
            white-space: nowrap;
        }
        .dots {
            margin: 0 4px;
            border-bottom: 1px dotted #000;
            flex: 1;
        }
        .page-number {
            white-space: nowrap;
            margin-left: 4px;
            text-align: right;
            min-width: 30px;
        }
        </style>
        </head>
        <body>
        <div class="toc-title">目录</div>`;

        const lines = tocContent.split('\n').filter(line => line.trim());
        const htmlLines = lines.map(line => {
            const indentMatch = line.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1].length : 0;
            const [title, page] = line.trim().split(/\s+(?=\d+$)/);
            
            return `<div class="toc-entry" style="padding-left: ${indent * 5}px">
                <span class="title">${title.replace(/["]/g, '')}</span>
                <span class="dots"></span>
                <span class="page-number">${page}</span>
            </div>`;
        }).join('\n');

        const finalHtml = tocHtml + htmlLines + '</body></html>';

        // Convert HTML to PDF using browser
        const page = await browser.newPage();
        await page.setContent(finalHtml);

        // Configure PDF options
        const pdfOptions = {
            format: 'A4',
            margin: {
                top: '50px',
                right: '50px',
                bottom: '50px',
                left: '50px'
            },
            printBackground: false
        };

        // Generate PDF
        const tocPdfBuffer = await page.pdf(pdfOptions);

        const tocPageEndTime = performance.now();
        const tocPageTimeMs = tocPageEndTime - tocPageStartTime;
        console.log(`Toc page generation took: ${(tocPageTimeMs / 1000).toFixed(2)} seconds`);

        return tocPdfBuffer
    }
}

module.exports = PdfWorker;
