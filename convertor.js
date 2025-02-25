const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');


require('dotenv').config();

class Convertor {

    constructor(pdfDir, logger) {

        this.pdfId = uuidv4();
        this.logger = logger

        this.pdfDir = pdfDir;
        this.filePath = path.join(this.pdfDir, `${this.pdfId}.cover.pdf`);
    }

    async process(docxPath, data) {
        try {
            // Generate paths
            const docxFileName = `${this.pdfId}.docx`;
            const tempDocxPath = path.join(this.pdfDir, docxFileName);
            
            // Copy and rename source file
            await fs.copyFile(docxPath, tempDocxPath);

            // fill template
            const zip = new AdmZip(tempDocxPath);
            const contentEntry = zip.getEntries().find(entry => entry.entryName === 'word/document.xml');
            if (!contentEntry) {
                throw new Error('DOCX 文件已损坏');
            }
            let content = zip.readAsText(contentEntry);
            for (const [key, value] of Object.entries(data)) {
                const searchStr = `«${key}»`;
                content = content.replace(searchStr, value);
            }
            zip.updateFile(contentEntry.entryName, Buffer.from(content));
            await fs.writeFile(tempDocxPath, zip.toBuffer());
            
            // Convert to PDF using LibreOffice
            const cmd = `libreoffice --headless --convert-to pdf --outdir "${this.pdfDir}" "${tempDocxPath}"`;
            await execAsync(cmd);
            
            // Verify PDF was created
            const pdfPath = path.join(this.pdfDir, `${this.pdfId}.pdf`);
            const exists = await fs.access(pdfPath).then(() => true).catch(() => false);
            
            if (!exists) {
                throw new Error('PDF conversion failed - output file not found');
            }
            
            this.logger.info(`Successfully converted ${docxPath} to ${pdfPath}`);
            return pdfPath;
            
        } catch (error) {
            this.logger.error(`PDF conversion failed: ${error.message}`);
            throw new Error(`Failed to convert document: ${error.message}`);
        } finally {
            const tempDocxPath = path.join(this.pdfDir, `${this.pdfId}.docx`);
            try {
                await fs.access(tempDocxPath);
                await fs.unlink(tempDocxPath);
                this.logger.debug('Cleaned up temporary DOCX file');
            } catch (cleanupError) {
                this.logger.warn(`Failed to cleanup temp file: ${cleanupError.message}`);
            }
        }
    }

}

module.exports = Convertor;