const defaultConfig = {
  app: {
    name: 'EVLoad',
    port: 3001,
    logLevel: 'info',
    logRetentionHours: 48,
  },
  vehicle: {
    vin: '',
    name: 'My Tesla',
    proxy: {
      host: '192.168.1.100',
      port: 8080,
    },
  },
  charging: {
    enabled: false,
    schedules: [
      {
        id: 'schedule-1',
        enabled: false,
        name: 'Overnight Charge',
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        startTime: '22:00',
        endTime: '06:00',
        targetLimit: 80,
      },
    ],
    balancing: {
      enabled: true,
      holdDurationMinutes: 30,
      minCurrentAmps: 1,
    },
  },
  climate: {
    enabled: false,
    schedules: [
      {
        id: 'climate-1',
        enabled: false,
        name: 'Morning Warmup',
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        startTime: '07:30',
        durationMinutes: 20,
        targetTempC: 21,
      },
    ],
  },
  polling: {
    intervalSeconds: 30,
    sleepCheckIntervalSeconds: 300,
    timeoutSeconds: 10,
    maxRetries: 3,
    backoffBaseSeconds: 5,
  },
};

module.exports = defaultConfig;
