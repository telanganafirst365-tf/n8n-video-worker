const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const https = require('https');
const app = express();
app.use(express.json());

// Helper function to download file
const downloadFile = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', (err) => { fs.unlink(dest, () => reject(err)); });
    });
};

app.post('/render', async (req, res) => {
    const { inputUrl, outputPath, headline, logoPath, fontPath } = req.body;
    const localInput = '/tmp/input.mp4';
    
    try {
        // 1. Download file first
        await downloadFile(inputUrl, localInput);
        
        // 2. Run FFmpeg
        ffmpeg()
            .input(localInput)
            .input(logoPath)
            .complexFilter(["scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base];[base]drawtext=fontfile='/usr/local/share/fonts/Poppins-Bold.ttf':text='" + headline + "':fontsize=32:fontcolor=white:x=60:y=1000[vtext];[1:v]scale=220:-1[logo];[vtext][logo]overlay=W-w-60:60[vout]"])
            .outputOptions(['-map [vout]', '-c:v libx264', '-preset veryfast', '-crf 23', '-c:a aac', '-b:a 128k', '-movflags +faststart'])
            .output(outputPath)
            .on('end', () => {
                fs.unlinkSync(localInput); // Clean up
                res.status(200).send({ status: 'success' });
            })
            .on('error', (err) => res.status(500).send({ error: err.message }))
            .run();
    } catch (err) {
        res.status(500).send({ error: 'Download failed: ' + err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT);
