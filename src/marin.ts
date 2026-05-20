import express from "express";
import helmet from "helmet";
import cors from "cors";

import mediaRoute from "./routes/media";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/health", (_, res) => {
    res.json({ ok: true });
});

app.use("/api", mediaRoute);

app.listen(9000, () => {
    console.log("running on 9000");
});