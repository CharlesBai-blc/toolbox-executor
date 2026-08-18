module.exports = {
  apps: [
    {
      name: 'executor',
      script: 'server.js',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
