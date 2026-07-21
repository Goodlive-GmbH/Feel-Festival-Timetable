import type { Config } from 'tailwindcss';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],

	theme: {
		extend: {
			colors: {
				'fest-text': '#142C50',
				'fest-widget': '#ECEED9',
				'fest-logo': '#F3A0A2',
				'fest-blue': '#2C53DE',
				'fest-beige': '#E0DCCC',
				'fest-turquoise': '#7BE0E4',
				'fest-cyan': '#3DC6F5',
				'fest-teal': '#38909F',
				'fest-dark-teal': '#236A88',
				'fest-green-teal': '#64B09C'
			},
			fontFamily: {
				'neo-heading': ['"Space Mono"', 'monospace', 'sans-serif'],
				'neo-body': ['"Inter"', 'sans-serif']
			}
		}
	},

	plugins: []
} as Config;
