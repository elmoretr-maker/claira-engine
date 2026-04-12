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
  const body = req.body ?? {};
  res.json({
    message: "Claira API connected",
    received: body,
  });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Claira server running on port ${port}`);
});
