import { Guild, ApplicationCommandOptionType } from 'discord.js';

// Define the commands array for reuse
export const commands = [
	{
		name: 'join',
		description: 'Joins the voice channel that you are in',
	},
	{
		name: 'record',
		description: 'Starts recording everyone in the voice channel',
	},
	{
		name: 'leave',
		description: 'Leave the voice channel',
	},
	{
		name: 'stop_recording',
		description: 'Stop the current recording and generate a transcript',
	},
	{
		name: 'cancel',
		description: 'Cancel the current recording without generating a transcript',
	},
];

export const deploy = async (guild: Guild) => {
	await guild.commands.set(commands);
};
