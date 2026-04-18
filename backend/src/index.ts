import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import parseRouter from './routes/parse';

declare module 'express-session' {
  interface SessionData {
    tokens: Record<string, any>;
  }
}

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true },
}));

app.use('/api/parse', parseRouter);

app.listen(PORT, () => console.log(`Shine backend running on http://localhost:${PORT}`));
