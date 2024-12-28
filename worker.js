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

    async generatePdf(task_id, taskData) {
        
        const totalStartTime = performance.now();
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

        const pdfId = uuidv4();
        
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
            await page.goto(`${process.env.CBM_BASE_URL}/dtas/preview.spr?task_id=${task_id}`, { waitUntil: 'networkidle2' });

            // Check page title matches task name
            await page.waitForSelector('title');
            const pageTitle = await page.title();
            if (pageTitle !== taskData.name) {
                console.error(`Title mismatch - Expected: "${taskData.name}", Got: "${pageTitle}"`);
                throw new Error('Page title does not match task name');
            }
            console.log(`Title verified: "${pageTitle}"`);
            
            // header of page
            const headerTemplate = `
                <div style="font-size: 10px; width: 100%; text-align: center;">
                    <span class="title"></span>
                </div>
            `;

            // footer of page
            const footerTemplate = `
                <div style="font-size: 10px; width: 100%; text-align: center;">
                    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
                </div>
            `;

            pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: false,
                displayHeaderFooter: true,
                headerTemplate,
                footerTemplate,
                margin: { // 调整这里的参数，需要重新生成 recipe.toml
                    top: '50px',
                    right: '50px',
                    bottom: '50px',
                    left: '50px'
                },
            });

            const convertEndTime = performance.now();
            const convertTimeMs = convertEndTime - convertStartTime;
            console.log(`PDF convert took: ${(convertTimeMs / 1000).toFixed(2)} seconds`);

            // Save PDF file with UUID
            const pdfDir = path.join(process.env.HOME, '.pdfworker');
            const configDir = path.join(pdfDir, 'config');
            const recipePath = path.join(configDir, 'recipe.toml');
            const filePath = path.join(pdfDir, `${pdfId}.pdf`);
            const outputPath = path.join(pdfDir, `${pdfId}_out.pdf`);
            const tocPath = path.join(pdfDir, `${pdfId}_toc.txt`);

            await fs.writeFile(filePath, pdfBuffer);
            console.log(`PDF saved to: ${filePath}`);

            try {
                // generate TOC
                const tocStartTime = performance.now();
                await execPromise(`pdftocgen "${filePath}" < "${recipePath}" > ${tocPath}`);
                await execPromise(`pdftocgen "${filePath}" < "${recipePath}" | pdftocio "${filePath}"`);
                const pdfWithToc = await fs.readFile(outputPath);

                const tocEndTime = performance.now();
                const tocTimeMs = tocEndTime - tocStartTime;
                console.log(`TOC generation took: ${(tocTimeMs / 1000).toFixed(2)} seconds`);

                // generate TOC page
                const tocPdfBuffer = await this.#generateTocPage(browser, tocPath);

                // generate title page
                // const titlePdfBuffer = await this.#generateTitlePage(browser, taskData);

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
                console.log(`Merge generation took: ${(mergeTimeMs / 1000).toFixed(2)} seconds`);

                return Buffer.from(finalPdfBytes);

            } catch (error) {
                console.error('TOC generation error:', error);
                return pdfBuffer; // Return original if TOC generation fails
            } finally {
                // Cleanup temporary files
                try {
                    await fs.unlink(filePath);
                    await fs.unlink(outputPath);
                    await fs.unlink(tocPath);
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
            console.log(`total generation took: ${(totalTimeMs / 1000).toFixed(2)} seconds`);
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

    async #generateTitlePage(browser, taskData){

    }
}

module.exports = PdfWorker;
