require('dotenv').config();
const express = require('express');
const PdfWorker = require('./worker');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

if (!process.env.CBM_BASE_URL) {
    console.error('CBM_BASE_URL environment variable is required');
    process.exit(1);
}

if (!process.env.CBM_API_KEY) {
    console.error('CBM_BASE_URL environment variable is required');
    process.exit(1);
}

if (!process.env.SECRET) {
    console.error('SECRET environment variable is required');
    process.exit(1);
}

const pdfDir = path.join(process.env.HOME, '.pdfworker');
const configDir = path.join(pdfDir, 'config');
const logsDir = path.join(pdfDir, 'logs');
const recipePath = path.join(configDir, 'recipe.toml');

// Check if recipePath exists
if (!fs.existsSync(recipePath)) {
    throw new Error(`recipe.toml does not exist: ${recipePath}`);
}

if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Configure Winston logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple()
        }),
        new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, 'pdfworker-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d',
            zippedArchive: true
        })
    ]
});

// Update error handling to use logger
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

const app = express();
const port = 5000;

app.get('/generate-pdf/:task_id/:user_id', async (req, res) => {
    const { task_id, user_id } = req.params;
    const template_name = req.query.template_name;
    logger.info(`PDF generation requested for task ${task_id} by user ${user_id}`);
    
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).send('No token provided');
    }

    try {
        const decoded = jwt.verify(token, process.env.SECRET);

        if (decoded.task_id != task_id || decoded.user_id != user_id) {
            return res.status(401).send('Invalid token payload');
        }

        if (Date.now() - decoded.timestamp > 15000) {
            return res.status(401).send('Token expired');
        }

        // from CBM fetch task detail
        const cbmTaskUrl = `${process.env.CBM_BASE_URL}/api/v3/items/${task_id}`;
        const cbmTaskResponse = await fetch(cbmTaskUrl, {
            headers: {
                Authorization: `Basic ${process.env.CBM_API_KEY}`,
                ContentType: 'application/json'
            }
        });

        logger.info(`fetch data for task ${task_id}, url = ${cbmTaskUrl}`);

        const responseData = await cbmTaskResponse.json()

        logger.info(`fetch data for task ${task_id}, status.code = ${cbmTaskResponse.status}`);

        if(cbmTaskResponse.status !== 200) {
            return res.status(cbmTaskResponse.status).send(responseData);
        }

        logger.info(`fetch data for task ${task_id}, task.name = ${responseData.name}`);

        const worker = new PdfWorker(pdfDir, logger);
        const pdfBuffer = await worker.generatePdf(task_id, responseData, template_name);

        const fileName = responseData.name ? 
            `${responseData.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf` : 
            'output.pdf';

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Length': pdfBuffer.length,
            'Cache-Control': 'no-cache'
        });

        res.write(pdfBuffer);
        res.end();
    } catch (error) {
        logger.error('Error generating PDF:', { error, task_id, user_id });
        res.status(500).send('Internal server error');
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${port}`);
});