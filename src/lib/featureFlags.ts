import { env } from '$env/dynamic/public';

export const SHOW_GENRE = env.PUBLIC_SHOW_GENRE === 'true';
