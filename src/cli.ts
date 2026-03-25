#!/usr/bin/env node
import { QuotaManagerApp } from './ui/app.js';

const app = new QuotaManagerApp();

app.start().catch((error) => {
  console.error(error);
  process.exit(1);
});
