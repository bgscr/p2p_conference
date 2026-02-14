import { startLocalMqttBroker } from './helpers/localMqttBroker'

export default async function globalSetup() {
  const broker = await startLocalMqttBroker()

  process.env.MQTT_PRIVATE_URL = broker.url
  process.env.MQTT_PRIVATE_USERNAME = 'e2e'
  process.env.MQTT_PRIVATE_PASSWORD = 'e2e'
  process.env.NODE_ENV = 'test'

  return async () => {
    await broker.stop()
  }
}
