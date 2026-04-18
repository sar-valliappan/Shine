import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import authRoutes from './routes/auth.js';
import docsRoutes from './routes/docs.js';
import sheetsRoutes from './routes/sheets.js';
import driveRoutes from './routes/drive.js';
import gmailRoutes from './routes/gmail.js';

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

// Workspace API routes
app.use('/api/docs', docsRoutes);
app.use('/api/sheets', sheetsRoutes);
app.use('/api/drive', driveRoutes);
app.use('/api/gmail', gmailRoutes);

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
