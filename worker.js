const puppeteer = require('puppeteer');
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

        try {
            browser = await puppeteer.launch({
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

            const headerTemplate = `
                <div style="font-size: 10px; width: 100%; text-align: center;">
                    <span class="title"></span>
                </div>
            `;

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
            return pdfBuffer;

        } finally {
            if (browser) {
                await browser.close();
            }
            console.log(`PDF generated in ${Date.now() - start}ms`);
        }
    }
}

module.exports = PdfWorker;
