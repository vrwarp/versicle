#!/bin/bash
npm run docs:generate
npm run lintdebt:check
npm run lint
npm test
