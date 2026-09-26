process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

// Keep tests hermetic: never touch a real MongoDB / Redis / S3 bucket.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/easytube_test';
process.env.REDIS_URL = 'redis://127.0.0.1:6379/1';
process.env.CLIENT_URL = 'http://localhost:5173';
