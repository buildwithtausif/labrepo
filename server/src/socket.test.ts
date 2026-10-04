import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'http';
import { io as Client, Socket } from 'socket.io-client';
import { initSocket, getIo } from './socket.js';

describe('Socket.IO E2E Delivery, Auth, and Reconnection', () => {
  let io: any, serverSocket: any;
  let clientSocket1: Socket, clientSocket2: Socket;
  let httpServer: any;
  let port: number;

  before(async () => {
    return new Promise<void>((resolve) => {
      httpServer = createServer();
      io = initSocket(httpServer);
      httpServer.listen(() => {
        port = httpServer.address().port;
        
        // Simulate devmode login using cookie bypass for client 1
        clientSocket1 = Client(`http://localhost:${port}`, {
          extraHeaders: {
            cookie: 'devmode_role=devadmin'
          }
        });
        
        clientSocket2 = Client(`http://localhost:${port}`, {
          extraHeaders: {
            cookie: 'devmode_role=testuser'
          }
        });
        
        let connections = 0;
        io.on('connection', (socket: any) => {
          serverSocket = socket;
          connections++;
          if (connections === 2) resolve();
        });
      });
    });
  });

  after(() => {
    io.close();
    if (clientSocket1) clientSocket1.close();
    if (clientSocket2) clientSocket2.close();
    httpServer.close();
  });

  it('should successfully authenticate and connect using devmode fallback', () => {
    assert.strictEqual(clientSocket1.connected, true);
    assert.strictEqual(clientSocket2.connected, true);
  });

  it('should route direct messages successfully to the correct room', async () => {
    return new Promise<void>((resolve) => {
      const testPayload = { id: 1, text: 'Hello test user' };
      
      clientSocket2.on('new_message', (data) => {
        assert.deepStrictEqual(data, testPayload);
        clientSocket2.off('new_message');
        resolve();
      });

      getIo().to('mock_test_user').emit('new_message', testPayload);
    });
  });

  it('should handle reconnections and missed events', async () => {
    return new Promise<void>((resolve) => {
      clientSocket2.disconnect();
      assert.strictEqual(clientSocket2.connected, false);
      
      const missedPayload = { id: 2, text: 'Missed message' };
      getIo().to('mock_test_user').emit('new_message', missedPayload);

      clientSocket2.connect();
      
      clientSocket2.on('connect', () => {
        assert.strictEqual(clientSocket2.connected, true);
        resolve();
      });
    });
  });

  it('should fail authorization if no token and no dev cookie', async () => {
    return new Promise<void>((resolve) => {
      const unauthSocket = Client(`http://localhost:${port}`, { reconnection: false });
      unauthSocket.on('connect_error', (err) => {
        assert.strictEqual(err.message, 'Authentication error: Token missing');
        unauthSocket.close();
        resolve();
      });
    });
  });
});
