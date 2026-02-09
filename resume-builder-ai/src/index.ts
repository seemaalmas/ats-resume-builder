import { createServer } from './server';

function start() {
  const port = process.env.PORT ? Number(process.env.PORT) : 7001;
  const app = createServer();
  app.listen(port, () => {
    console.log(`resume-builder-ai listening on ${port}`);
  });
}

start();
