/**
 * Credentials Manager
 * 
 * Stores sensitive credentials in the main process.
 * While these are still bundled in the app, they are:
 * 1. Separated from the renderer code (harder to find)
 * 2. Not directly accessible from DevTools console
 * 3. Will be obfuscated when building for production
 * 
 * SECURITY NOTE: This is NOT a complete security solution.
 * For production, consider implementing:
 * - Time-limited TURN credentials via REST API (Coturn supports this)
 * - JWT-based MQTT authentication
 * - A lightweight credential service that issues short-lived tokens
 */

// Load from environment variables if available, otherwise use defaults
// In production, these should be set via environment or a secure config
const TURN_CONFIG = {
  urls: process.env.TURN_URLS?.split(',') || ['turn:47.111.10.155:3478'],
  username: process.env.TURN_USERNAME || 'turnuser',
  credential: process.env.TURN_CREDENTIAL || 'huUKPizqnXPY5W94BXpPh3hZ4nZcdhA3'
}

const MQTT_CONFIG = {
  // Private broker with authentication
  private: {
    url: process.env.MQTT_PRIVATE_URL || 'ws://47.111.10.155:8083/mqtt',
    username: process.env.MQTT_PRIVATE_USERNAME || 'mqtt_admin',
    password: process.env.MQTT_PRIVATE_PASSWORD || 'Q32yrcmtp53tpnEpSZj7nTZUmqKML6mF'
  },
  // Public brokers (no auth needed)
  public: [
    { url: 'wss://broker.emqx.io:8084/mqtt' },
    { url: 'wss://broker-cn.emqx.io:8084/mqtt' },
    { url: 'wss://test.mosquitto.org:8081/mqtt' }
  ]
}

// Public STUN servers (no credentials needed)
const STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun.cloudflare.com:3478'
]

export interface ICEServerConfig {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface MQTTBrokerConfig {
  url: string
  username?: string
  password?: string
}

/**
 * Get ICE server configuration (STUN + TURN)
 */
export function getICEServers(): ICEServerConfig[] {
  const servers: ICEServerConfig[] = []
  
  // Add STUN servers
  STUN_SERVERS.forEach(url => {
    servers.push({ urls: url })
  })
  
  // Add TURN server with credentials
  servers.push({
    urls: TURN_CONFIG.urls,
    username: TURN_CONFIG.username,
    credential: TURN_CONFIG.credential
  })
  
  return servers
}

/**
 * Get MQTT broker configurations
 */
export function getMQTTBrokers(): MQTTBrokerConfig[] {
  const brokers: MQTTBrokerConfig[] = []
  
  // Add private broker with credentials
  brokers.push({
    url: MQTT_CONFIG.private.url,
    username: MQTT_CONFIG.private.username,
    password: MQTT_CONFIG.private.password
  })
  
  // Add public brokers
  MQTT_CONFIG.public.forEach(broker => {
    brokers.push(broker)
  })
  
  return brokers
}

/**
 * Future: Generate time-limited TURN credentials
 * This would be used with Coturn's REST API authentication
 * 
 * @param sharedSecret - The shared secret configured in Coturn
 * @param username - Base username (typically the user's ID)
 * @param ttl - Time to live in seconds (default 24 hours)
 */
export function generateTURNCredentials(
  sharedSecret: string,
  username: string,
  ttl: number = 86400
): { username: string; credential: string } {
  const crypto = require('crypto')
  
  // Timestamp-based username format: timestamp:username
  const timestamp = Math.floor(Date.now() / 1000) + ttl
  const turnUsername = `${timestamp}:${username}`
  
  // HMAC-SHA1 of the username using the shared secret
  const hmac = crypto.createHmac('sha1', sharedSecret)
  hmac.update(turnUsername)
  const credential = hmac.digest('base64')
  
  return { username: turnUsername, credential }
}
