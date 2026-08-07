#!/usr/bin/env node

const minimumMajor = 22;
const currentNode = process.versions.node;
const currentMajor = Number.parseInt(currentNode.split('.')[0], 10);

if (Number.isNaN(currentMajor) || currentMajor < minimumMajor) {
  console.error(
    `This project requires Node ${minimumMajor}+ (current: ${currentNode}).\nPlease switch to Node ${minimumMajor} with nvm, fnm, or Volta before running the build.`
  );
  process.exit(1);
}

console.log(`Node ${currentNode} is compatible with this project.`);
