const puppeteer = require('puppeteer');
const { PDFDocument, rgb } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const Convertor = require('./convertor')

require('dotenv').config();

class PdfWorker {
    constructor(pdfDir, logger) {
        this.pdfId = uuidv4();
        this.logger = logger;
        this.pdfDir = pdfDir;
        this.configDir = path.join(this.pdfDir, 'config');
        this.recipePath = path.join(this.configDir, 'recipe.toml');
        this.filePath = path.join(this.pdfDir, `${this.pdfId}.pdf`);
        this.outputPath = path.join(this.pdfDir, `${this.pdfId}_out.pdf`);
        this.tocPath = path.join(this.pdfDir, `${this.pdfId}_toc.txt`);
    }

    async generatePdf(task_id, taskData, template_name, trackerData, previewMetadata) {
        const totalStartTime = performance.now();
        this.logger.info(`PDF,${this.pdfId},Start`);

        let browser = null;
        let pdfBuffer = null;

        if (!process.env.CBM_BASE_URL) throw new Error('CBM_BASE_URL environment variable is required');
        if (!process.env.CBM_API_KEY) throw new Error('CBM_API_KEY environment variable is required');

        const decoded = Buffer.from(process.env.CBM_API_KEY, 'base64').toString();
        const [username, password] = decoded.split(':');
        if (!username || !password) throw new Error('Invalid CBM_API_KEY format. Expected base64 encoded username:password');

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

            const params = new URLSearchParams({ task_id });
            if (template_name?.trim()) params.append('template_name', template_name.trim());

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

            // Extract data from input elements within div#metric
            const metricData = await page.evaluate(() => {
                const metricDiv = document.getElementById('metric');
                if (!metricDiv) return {};

                const inputs = metricDiv.querySelectorAll('input');
                const data = {};
                
                inputs.forEach(input => {
                    if (input.id) {
                        data[input.id] = input.value;
                    }
                });
                
                return data;
            });

            this.logger.info(`PDF,${this.pdfId},Extracted metric data:`, metricData);

            // Use headerTemplate and footerTemplate from previewMetadata if available
            this.headerTemplate = previewMetadata?.headerTemplate || `
                <div style="font-size: 10px; width: 100%; text-align: center; vertical-align: bottom; padding: 20px 0px;">
                    <span>${trackerData.description}</span>
                    <div style="border-bottom: 1px solid black;width:inhert;margin-left: 50px;margin-right: 50px;">&nbsp</div>
                </div>
            `;

            this.footerTemplate = previewMetadata?.footerTemplate || `
                <div style="font-size: 10px; width: 100%; text-align: center;">
                    <div style="border-bottom: 1px solid black;width:inhert;margin-left: 50px;margin-right: 50px;">&nbsp</div>
                    <table style="width: 100%; padding: 0px 50px;">
                        <tr>
                            <td style="text-align: left; width: 30%;">@ copyright</td>
                            <td style="text-align: center; vertical-align: top;"><span class="title"></span></td>
                            <td style="text-align: right; width: 30%; vertical-align: top;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></td>
                        </tr>
                    </table>
                </div>
            `;

            // 从页面中移除 class=_ignore 的元素
            await page.evaluate(() => {
                const elementsToRemove = document.querySelectorAll('._ignore');
                elementsToRemove.forEach(element => element.remove());
            });

            let landscape = false

            // Get page body width in mm from page
            const bodyWidth = await page.evaluate(() => {
                const body = document.body;
                const style = window.getComputedStyle(body);
                const widthStr = style.width;
                // Convert pixels to mm (1 inch = 25.4mm, 1 inch = 96px)
                const widthPx = parseFloat(widthStr);
                const widthMm = (widthPx * 25.4) / 96;
                return widthMm;
            });

            // Set landscape to true if width is greater than A4 height (210mm)
            landscape = bodyWidth > 210;

            // 主内容
            pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                displayHeaderFooter: true,
                headerTemplate: this.headerTemplate,
                footerTemplate: this.footerTemplate,
                landscape: landscape, // Add this line to set landscape orientation
                margin: {
                    top: '70px',
                    right: '50px',
                    bottom: '70px',
                    left: '50px'
                },
            });

            const convertEndTime = performance.now();
            this.logger.info(`PDF,${this.pdfId},PDF convert took: ${(convertEndTime - convertStartTime) / 1000} seconds`);

            await fs.writeFile(this.filePath, pdfBuffer);

            // 封面
            // const coverStartTime = performance.now();
            // const convertor = new Convertor(this.pdfDir, this.logger)
            // const cover = await convertor.process(`${this.configDir}/${previewMetadata.coverTemplate}`, previewMetadata.coverData)
            // const coverEndTime = performance.now();
            // this.logger.info(`PDF,${this.pdfId},cover generate took: ${(coverEndTime - coverStartTime) / 1000} seconds`);

            // 目录
            if (previewMetadata && previewMetadata.renderTOC === true) {
                try {
                    const finalPdfBytes = await this.#generateTocAndMerge(browser, task_id, previewMetadata);
                    return {
                        pdfBuffer: Buffer.from(finalPdfBytes),
                        metricData
                    };
                } catch (error) {
                    this.logger.error(`PDF,${this.pdfId},TOC generation error: ${error}`);
                    return {
                        pdfBuffer,
                        metricData
                    };
                }
            }

            // Return both pdfBuffer and metricData
            return {
                pdfBuffer,
                metricData
            };
        } catch(error) {
            this.logger.error("", error)
        } finally {
            if (browser) await browser.close();
            const totalEndTime = performance.now();
            this.logger.info(`PDF,${this.pdfId},Total generation took: ${(totalEndTime - totalStartTime) / 1000} seconds`);
        }
    }

    async #generateTocAndMerge(browser, task_id, metadata) {
        // 生成封面
        const coverStartTime = performance.now();
        const convertor = new Convertor(this.pdfDir, this.logger)
        const cover = await convertor.process(`${this.configDir}/${metadata.coverTemplate}`, metadata.coverData)
        const coverEndTime = performance.now();
        this.logger.info(`PDF,${this.pdfId},cover generate took: ${(coverEndTime - coverStartTime) / 1000} seconds`);

        // 生成变更记录
        const historyStartTime = performance.now();
        const page = await browser.newPage();
        await page.goto(`${process.env.CBM_BASE_URL}/dtas/preview-history.spr?task_id=${task_id}`, { 
            waitUntil: 'networkidle2' 
        });
        
        const historyPdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: this.headerTemplate,
            footerTemplate: this.footerTemplate,
            margin: {
                top: '70px',
                right: '50px',
                bottom: '70px',
                left: '50px'
            }
        });
        
        this.logger.info(`PDF,${this.pdfId},History generation took: ${(performance.now() - historyStartTime) / 1000} seconds`);

        // 生成目录
        const tocStartTime = performance.now();
        await execPromise(`pdftocgen "${this.filePath}" < "${this.recipePath}" > ${this.tocPath}`);
        await execPromise(`pdftocgen -v "${this.filePath}" < "${this.recipePath}" | pdftocio "${this.filePath}"`);
        const pdfWithToc = await fs.readFile(this.outputPath);
        const tocPdfBuffer = await this.#generateTocPage(browser, this.tocPath);
        this.logger.info(`PDF,${this.pdfId},TOC generation took: ${(performance.now() - tocStartTime) / 1000} seconds`);

        // Merge 封面，变更记录，目录 and 主内容
        const mergeStartTime = performance.now();

        const mainDoc = await PDFDocument.load(pdfWithToc);
        const tocDoc = await PDFDocument.load(tocPdfBuffer);
        const coverBuffer = await fs.readFile(cover);
        const coverDoc = await PDFDocument.load(coverBuffer);
        const historyDoc = await PDFDocument.load(historyPdfBuffer);

        // 按顺序合并: 封面，变更记录，目录，主内容
        const coverPages = await mainDoc.copyPages(coverDoc, coverDoc.getPageIndices());
        const historyPages = await mainDoc.copyPages(historyDoc, historyDoc.getPageIndices());
        const tocPages = await mainDoc.copyPages(tocDoc, tocDoc.getPageIndices());

        // Insert pages in reverse order at the beginning
        tocPages.reverse();
        for (const page of tocPages) {
            mainDoc.insertPage(0, page);
        }

        historyPages.reverse();
        for (const page of historyPages) {
            mainDoc.insertPage(0, page);
        }

        mainDoc.insertPage(0, coverPages[0]);

        const finalPdfBytes = await mainDoc.save();

        this.logger.info(`PDF,${this.pdfId},Merge generation took: ${(performance.now() - mergeStartTime) / 1000} seconds`);

        // Cleanup temporary files
        try {
            await fs.unlink(this.filePath);
            await fs.unlink(this.outputPath);
            await fs.unlink(this.tocPath);
            await fs.unlink(cover);
        } catch (err) {
            console.error('Cleanup error:', err);
        }

        return finalPdfBytes;
    }

    async #generateTocPage(browser, tocPath) {
        const tocPageStartTime = performance.now();

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
            white-space: break-word;
            word-break: break-all;
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

        const page = await browser.newPage();
        await page.setContent(finalHtml);

        const pdfOptions = {
            format: 'A4',
            displayHeaderFooter: true,
            headerTemplate: this.headerTemplate,
            footerTemplate: this.footerTemplate,
            margin: {
                top: '70px',
                right: '50px',
                bottom: '70px',
                left: '50px'
            },
            printBackground: false
        };

        const tocPdfBuffer = await page.pdf(pdfOptions);

        this.logger.info(`PDF,${this.pdfId},Toc page generation took: ${(performance.now() - tocPageStartTime) / 1000} seconds`);

        return tocPdfBuffer;
    }
}

module.exports = PdfWorker;