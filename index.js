const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { JSDOM } = require("jsdom");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const HUGGINGFACE_API_TOKEN = process.env.HUGGINGFACE_API_KEY; // Optional for some models
const SUMMARY_MODEL = "facebook/bart-large-cnn";

async function fetchTextFromUrl(url) {
    const html = await axios.get(url);
    const dom = new JSDOM(html.data);
    const paragraphs = [...dom.window.document.querySelectorAll("p")];
    const text = paragraphs.map(p => p.textContent).join(" ");
    return text.slice(0, 3000);
}

async function queryHuggingFace(model, input, retries = 3) {
    try {
        const response = await axios.post(
            `https://api-inference.huggingface.co/models/${model}`,
            { inputs: input },
            {
                headers: {
                    Authorization: `Bearer ${HUGGINGFACE_API_TOKEN}`,
                },
            }
        );
        return response.data;
    } catch (error) {
        if (retries > 0 && error.response?.status === 503) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            return queryHuggingFace(model, input, retries - 1);
        }
        throw error;
    }
}

app.get("/", (req, res) => {
    res.send("App is running");
})

app.get("/api/health", (req, res) => {
    res.send("Api is running");
})

app.post("/api/extract", async (req, res) => {
    try {
        const { url } = req.body;
        const content = await fetchTextFromUrl(url);

        const summaryData = await queryHuggingFace(SUMMARY_MODEL, content);
        const summary = summaryData[0]?.summary_text || "";

        // Generate key points
        const keyPoints = generateKeyPoints(summary);

        res.json({
            title: new URL(url).hostname.split(".")[1],
            url,
            summary,
            keyPoints,
            language: "en",
            tags: ["ai-generated"],
            extractedAt: new Date().toISOString(),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Function to generate key points from the summary
function generateKeyPoints(summary) {
    // Split the summary into sentences
    const sentences = summary.split(".").map((s) => s.trim()).filter(Boolean);

    // Apply a more intelligent filtering approach:
    const keyPointSentences = sentences.filter((s) => {
        // Prioritize sentences that provide important actions, features, or distinct ideas
        return s.length > 30 && !s.includes("React"); // Exclude overly general sentences
    });

    // Return the top 3 key points, ensuring they are distinct and not repetitive
    const keyPoints = [];
    keyPointSentences.forEach((sentence) => {
        // Add only distinct sentences
        if (
            !keyPoints.some((keyPoint) =>
                keyPoint.toLowerCase().includes(sentence.toLowerCase())
            )
        ) {
            keyPoints.push(sentence);
        }
    });

    // If there are fewer than 3 key points, add a fallback
    if (keyPoints.length < 3) {
        keyPoints.push("More information available on the website.");
    }

    // Return a maximum of 5 key points to avoid too many
    return keyPoints.slice(0, 5);
}

app.listen(process.env.PORT, () => console.log(`Server running on port:${process.env.PORT}`));
