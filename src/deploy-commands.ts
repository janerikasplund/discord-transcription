import { REST, Routes } from 'discord.js';
import { commands } from './deploy';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { token } = require('../auth.json');

// Create a REST instance
const rest = new REST({ version: '10' }).setToken(token);

async function deployCommands() {
    try {
        console.log('Started refreshing application (/) commands...');

        // Get the application ID
        const app = await rest.get('/applications/@me');
        const applicationId = (app as any).id;

        if (!applicationId) {
            throw new Error('Could not get application ID');
        }

        console.log(`Application ID: ${applicationId}`);

        // Deploy global commands
        const data = await rest.put(
            Routes.applicationCommands(applicationId),
            { body: commands },
        );

        console.log(`Successfully reloaded application (/) commands globally.`);
    } catch (error) {
        console.error('Error deploying commands:', error);
    }
}

// Run the deployment
deployCommands(); 