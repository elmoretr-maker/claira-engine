import express from "express";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Claira API running",
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "claira",
  });
});

app.post("/run", (req, res) => {
  try {
    console.log("Webhook received from Wix:");
    console.log(JSON.stringify(req.body, null, 2));

    return res.status(200).json({
      success: true,
      message: "Webhook received",
    });
  } catch (err) {
    console.error("Webhook error:", err);

    return res.status(200).json({
      success: false,
      error: "Handled safely",
    });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Claira server running on port ${port}`);
});
