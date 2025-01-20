require('dotenv').config();
const express = require('express');
const PdfWorker = require('./worker');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');
const timeout = require('connect-timeout');


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

app.use(timeout('20m')); // 设置全局超时时间为 20 分钟

app.use((req, res, next) => {
    if (!req.timedout) next();
});

// Add new function
async function fetchCBMTaskDetails(taskId) {
    try {
        const cbmTaskUrl = `${process.env.CBM_BASE_URL}/api/v3/items/${taskId}`;
        const cbmTaskResponse = await fetch(cbmTaskUrl, {
            headers: {
                Authorization: `Basic ${process.env.CBM_API_KEY}`,
                ContentType: 'application/json'
            }
        });

        if (!cbmTaskResponse.ok) {
            throw new Error(`Failed to fetch CBM task: ${cbmTaskResponse.status}`);
        }

        return await cbmTaskResponse.json();
    } catch (error) {
        console.error('Error fetching CBM task details:', error);
        throw error;
    }
}

// Add new function at top level
async function fetchTrackerDetails(trackerId) {
    const cbmTrackerUrl = `${process.env.CBM_BASE_URL}/api/v3/trackers/${trackerId}`;
    logger.info(`Fetching tracker ${trackerId} data, url = ${cbmTrackerUrl}`);
    
    const cbmTrackerResponse = await fetch(cbmTrackerUrl, {
        headers: {
            Authorization: `Basic ${process.env.CBM_API_KEY}`,
            ContentType: 'application/json'
        }
    });
    
    const trackerJson = await cbmTrackerResponse.json();
    
    if (cbmTrackerResponse.status !== 200) {
        throw new Error(`Failed to fetch tracker: ${cbmTrackerResponse.status}`);
    }
    
    return trackerJson;
}

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
        const taskDetails = await fetchCBMTaskDetails(task_id);
        logger.info(`fetch data for task ${task_id}, task.name = ${taskDetails.name}`);

        // from CBM fetch tracker detail
        const trackerJson = await fetchTrackerDetails(taskDetails.tracker.id);
        logger.info(`Retrieved tracker ${trackerJson.id}, description = ${trackerJson.description}`);

        const worker = new PdfWorker(pdfDir, logger);
        const pdfBuffer = await worker.generatePdf(task_id, taskDetails, template_name, trackerJson);

        const fileName = taskDetails.name ? 
            `${taskDetails.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf` : 
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

app.get('/generate-word/:task_id/:user_id', async (req, res) => {
    const { task_id, user_id } = req.params;
    const template_name = req.query.template_name;
    logger.info(`Word generation requested for task ${task_id} by user ${user_id}`);

    // const token = req.headers.authorization?.split(' ')[1];
    
    // if (!token) {
    //     return res.status(401).send('No token provided');
    // }

    try {
        // const decoded = jwt.verify(token, process.env.SECRET);

        // if (decoded.task_id != task_id || decoded.user_id != user_id) {
        //     return res.status(401).send('Invalid token payload');
        // }

        // if (Date.now() - decoded.timestamp > 15000) {
        //     return res.status(401).send('Token expired');
        // }

        // from CBM fetch task detail
        const taskDetails = await fetchCBMTaskDetails(task_id);
        logger.info(`fetch data for task ${task_id}, task.name = ${taskDetails.name}`);

        // from CBM fetch tracker detail
        const trackerJson = await fetchTrackerDetails(taskDetails.tracker.id);
        logger.info(`Retrieved tracker ${trackerJson.id}, description = ${trackerJson.description}`);


    } catch (error) {
        logger.error('Error generating Word:', { error, task_id, user_id });
        res.status(500).send('Internal server error');
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${port}`);
});