const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const app = express();
app.use(express.json());

app.post('/render', (req, res) => {
    const { inputPath, outputPath, headline, logoPath, fontPath } = req.body;
    
    // Safety check
    if (!inputPath || !outputPath) return res.status(400).send('Missing paths');

    ffmpeg()
        .input(inputPath)
        .input(logoPath)
        .complexFilter([
            "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base];[base]drawtext=fontfile='" + fontPath + "':text='" + headline + "':fontsize=32:fontcolor=white:x=60:y=1000[vtext];[1:v]scale=220:-1[logo];[vtext][logo]overlay=W-w-60:60[vout]"
        ])
        .outputOptions(['-map [vout]', '-c:v libx264', '-preset veryfast', '-crf 23', '-c:a aac', '-b:a 128k', '-movflags +faststart'])
        .output(outputPath)
        .on('end', () => res.status(200).send({ status: 'success' }))
        .on('error', (err) => res.status(500).send({ error: err.message }))
        .run();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Worker is ready on port ' + PORT));
