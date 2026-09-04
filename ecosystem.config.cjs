module.exports = {
  apps: [
    {
      name: 'happamochi-bot',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=line-group-bbs-db --local --ip 0.0.0.0 --port 3000',
      cwd: '/home/user/happamochi-bot',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
    },
  ],
}
