import { config } from "dotenv";
import express from "express";
import morgan from "morgan";
import helmet from "helmet";
import cors from "cors";
import { createServer } from "http";
import {name} from "../package.json"
config();

const app = express();
app.use(morgan('dev'));
app.use(helmet());
const urls = process.env.ORIGIN_URL?.split(",")
app.use(cors({
  origin: urls,
  credentials: true,
  methods: ['GET', 'POST'],
}));
app.use(express.json());

const server = createServer(app);
// const io = new ServerIo(server, {
//   cors: {
//     origin: [process.env.CLIENT_URL ?? 'http://localhost:3000'],
//     methods: ['GET', 'POST'],
//   }
// });

const port = process.env.PORT ?? 8000;
server.listen(port, () => {
  /* eslint-disable no-console */
  console.log(`Listening: http://localhost:${port}`);
  /* eslint-enable no-console */
});

app.get('/', (req, res) => {
    res.json({
      name,
      date: new Date().toLocaleDateString(),
    });
});