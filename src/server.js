import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('NestFair API is running');
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'NestFair backend is healthy',
  });
});

app.listen(port, () => {
  console.log(`NestFair API is listening on port ${port}`);
});
