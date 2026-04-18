import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import authRoutes from './routes/auth.js';

const app = express();
const PORT = process.env.PORT || 3001;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-key';

// Middleware
app.use(express.json());

// Session middleware - must come before routes
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Auth routes
app.use('/api/auth', authRoutes);

// Placeholder routes for workspace APIs (we'll fill these in Phase 2)
app.get('/api/docs/create', (req, res) => {
  res.json({ message: 'Google Docs route will be implemented in Phase 2' });
});

app.get('/api/sheets/create', (req, res) => {
  res.json({ message: 'Google Sheets route will be implemented in Phase 2' });
});

app.get('/api/drive/list', (req, res) => {
  res.json({ message: 'Google Drive route will be implemented in Phase 2' });
});

app.get('/api/gmail/draft', (req, res) => {
  res.json({ message: 'Gmail route will be implemented in Phase 2' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
  console.log(`📝 Auth URL: http://localhost:${PORT}/api/auth/google`);
});
