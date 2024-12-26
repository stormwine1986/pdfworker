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
        const start = Date.now();
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
                margin: {
                    top: '50px',
                    right: '50px',
                    bottom: '50px',
                    left: '50px'
                },
            });

            // Save PDF file with UUID
            const pdfDir = path.join(process.env.HOME, '.pdfworker');
            const configDir = path.join(pdfDir, 'config');
            const recipePath = path.join(configDir, 'recipe.toml');
            
            const filePath = path.join(pdfDir, `${pdfId}.pdf`);
            const outputPath = path.join(pdfDir, `${pdfId}_out.pdf`);
            await fs.writeFile(filePath, pdfBuffer);
            
            console.log(`PDF saved to: ${filePath}`);

            // generate TOC
            try {
                await execPromise(`pdftocgen "${filePath}" < "${recipePath}" | pdftocio "${filePath}"`);
                const pdfWithToc = await fs.readFile(outputPath);

                // Add title page
                const pdfDoc = await PDFDocument.load(pdfWithToc);
                const titlePage = pdfDoc.insertPage(0);
                const { width, height } = titlePage.getSize();
                
                // Add title text
                const font = await pdfDoc.embedFont('Helvetica');
                titlePage.drawText(taskData.name, {
                    x: width / 2,
                    y: height / 2,
                    size: 24,
                    font: font,
                    color: rgb(0, 0, 0),
                    align: 'center'
                });

                // Save modified PDF
                const finalPdfBytes = await pdfDoc.save();
                return Buffer.from(finalPdfBytes);

            } catch (error) {
                console.error('TOC generation error:', error);
                return pdfBuffer; // Return original if TOC generation fails
            } finally {
                // Cleanup temporary files
                try {
                    await fs.unlink(filePath);
                    await fs.unlink(outputPath);
                } catch (err) {
                    console.error('Cleanup error:', err);
                }
            }

        } finally {
            if (browser) {
                await browser.close();
            }
            console.log(`PDF generated in ${Date.now() - start}ms`);
        }
    }
}

module.exports = PdfWorker;
