require('dotenv').config();
const express = require('express');
const PdfWorker = require('./worker');
const Connector = require('./connector')
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

app.use(timeout('30m')); // 设置全局超时时间为 20 分钟

app.use((req, res, next) => {
    if (!req.timedout) next();
});

// async function fetchCBMTaskDetails(taskId) {
//     try {
//         const cbmTaskUrl = `${process.env.CBM_BASE_URL}/api/v3/items/${taskId}`;
//         const cbmTaskResponse = await fetch(cbmTaskUrl, {
//             headers: {
//                 Authorization: `Basic ${process.env.CBM_API_KEY}`,
//                 ContentType: 'application/json'
//             }
//         });

//         if (!cbmTaskResponse.ok) {
//             throw new Error(`Failed to fetch CBM task: ${cbmTaskResponse.status}`);
//         }

//         return await cbmTaskResponse.json();
//     } catch (error) {
//         console.error('Error fetching CBM task details:', error);
//         throw error;
//     }
// }

// async function fetchPreviewMetadata(task_id, template_name) {
//     try {
//         const params = new URLSearchParams({
//             task_id: task_id
//         });

//         if (template_name?.trim()) {
//             params.append('template_name', template_name.trim());
//         }

//         const preview_metadata_url = `${process.env.CBM_BASE_URL}/dtas/preview-metadata.spr?${params.toString()}`;

//         const response = await fetch(preview_metadata_url, {
//             headers: {
//                 Authorization: `Basic ${process.env.CBM_API_KEY}`,
//                 ContentType: 'application/json'
//             }
//         });

//         if (!response.ok) {
//             throw new Error(`Failed to fetch preview metadata: ${response.status}`);
//         }

//         return await response.json();

//     } catch (error) {
//         console.error('Error fetching Preview Metadata:', error);
//         throw error;
//     }
// }

// async function fetchTrackerDetails(trackerId) {
//     const cbmTrackerUrl = `${process.env.CBM_BASE_URL}/api/v3/trackers/${trackerId}`;
//     logger.info(`Fetching tracker ${trackerId} data, url = ${cbmTrackerUrl}`);

//     const cbmTrackerResponse = await fetch(cbmTrackerUrl, {
//         headers: {
//             Authorization: `Basic ${process.env.CBM_API_KEY}`,
//             ContentType: 'application/json'
//         }
//     });

//     const trackerJson = await cbmTrackerResponse.json();

//     if (cbmTrackerResponse.status !== 200) {
//         throw new Error(`Failed to fetch tracker: ${cbmTrackerResponse.status}`);
//     }

//     return trackerJson;
// }

app.get('/generate-pdf/:task_id/:user_id', async (req, res) => {

    increment()

    try {
        // verify parameters
        const { task_id, user_id } = req.params;
        const template_name = req.query.template_name;
        logger.info(`PDF generation requested for task ${task_id} by user ${user_id}`);

        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).send('No token provided');
        }

        // verify jwt
        const decoded = jwt.verify(token, process.env.SECRET);
        if (decoded.task_id != task_id || decoded.user_id != user_id) {
            return res.status(401).send('Invalid token payload');
        }
        if (Date.now() - decoded.timestamp > 15000) {
            return res.status(401).send('Token expired');
        }

        const connector = new Connector(task_id, logger);

        // from CBM fetch task detail
        const taskDetails = await connector.fetchCBMTaskDetails();
        logger.info(`fetch data for task ${task_id}, task.name = ${taskDetails.name}`);

        // from CBM fetch tracker detail
        const trackerJson = await connector.fetchTrackerDetails();
        logger.info(`Retrieved tracker ${trackerJson.id}, description = ${trackerJson.description}`);

        // Fetch preview metadata
        const previewMetadata = await connector.fetchPreviewMetadata(template_name);
        logger.info(`Fetched preview metadata for task ${task_id}`, previewMetadata);

        const worker = new PdfWorker(pdfDir, logger);
        // 修改这里接收 pdfBuffer 和 metricData
        const { pdfBuffer, metricData } = await worker.generatePdf(task_id, taskDetails, template_name, trackerJson, previewMetadata);

        const fileName = taskDetails.name ?
            `${taskDetails.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf` :
            'output.pdf';

        // 设置基本响应头
        const headers = {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Length': pdfBuffer.length,
            'Cache-Control': 'no-cache'
        };

        // 如果 metricData 存在且不为空，添加 metric 响应头
        if (metricData && Object.keys(metricData).length > 0) {
            for (const [key, value] of Object.entries(metricData)) {
                headers[`x-metric-${key}`] = value;
            }
        }

        res.set(headers);
        res.write(pdfBuffer);
        res.end();
    } catch (error) {
        logger.error('Error generating PDF:', {
            error: {
                message: error.message,
                name: error.name,
                stack: error.stack,
                code: error.code
            },
            context: {
                task_id,
                template_name,
                timestamp: new Date().toISOString()
            }
        });
        res.status(500).send('Internal server error');
    } finally {
        decrement()
    }
});

// 创建一个共享的数组缓冲区
const sab = new SharedArrayBuffer(4); // 4 字节用于存储一个整数
const counter = new Int32Array(sab); // 创建一个 32 位整数数组

// 增加计数器的函数
function increment() {
    Atomics.add(counter, 0, 1); // 原子加1
}

// 减少计数器的函数
function decrement() {
    Atomics.sub(counter, 0, 1); // 原子减1
}

// 获取当前计数器值的函数
function getCount() {
    return Atomics.load(counter, 0); // 原子读取当前值
}

// // Add cleanup handler
// process.on('SIGTERM', () => {
//     clearInterval(counterMonitor);
//     process.exit(0);
// });

// Health check endpoint
app.get('/health', (req, res) => {
    const currentCount = getCount();
    const maxProcesses = parseInt(process.env.MAX_PROCESS_NUM || '10');

    if (currentCount > maxProcesses) {
        return res.status(503).json({
            status: 'overloaded',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            activeWorkerCount: currentCount,
            maxWorkers: maxProcesses
        });
    }

    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        activeWorkerCount: currentCount,
        maxWorkers: maxProcesses
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${port}`);
});