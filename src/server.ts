import express from "express";
import cors from "cors";
const app = express();

app.set("trust proxy", 1);


app.use(
  cors({
 
  })
);




export default app;
