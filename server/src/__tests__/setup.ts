// Set minimal env vars so config/env.ts validates successfully in tests
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.STYTCH_PROJECT_ID = 'project-test-00000000-0000-0000-0000-000000000000';
process.env.STYTCH_SECRET = 'secret-test-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
process.env.STYTCH_ENV = 'test';
process.env.PORT = '8081';
