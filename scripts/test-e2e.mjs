import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

// Give independent test invocations their own server and report directory.
// Never attach to an agent's possibly stale development server.
async function availablePort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, 'localhost', resolve);
	});
	const { port } = server.address();
	await new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve()))
	);
	return String(port);
}

const port = process.env.PLAYWRIGHT_PORT || (await availablePort());
console.log(`E2E server port: ${port}; report: playwright-report/e2e-${port}`);
const child = spawn(
	process.execPath,
	['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
	{
		stdio: 'inherit',
		env: { ...process.env, PLAYWRIGHT_PORT: port }
	}
);
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
	console.error(error);
	process.exitCode = 1;
});
child.on('exit', (code, signal) => {
	process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});
