<script lang="ts">
	import birdLogo from '$lib/assets/Bird Feel Festival pink.svg';

	let { onclose, canInstall = false, oninstall, showIosInstallHint = false } = $props<{
		onclose: () => void;
		canInstall?: boolean;
		oninstall?: () => void;
		showIosInstallHint?: boolean;
	}>();
</script>

<div
	class="fixed inset-0 z-[200] flex items-center justify-center bg-fest-text/80 p-4 backdrop-blur-sm"
	role="dialog"
	aria-modal="true"
	aria-labelledby="welcome-title"
>
	<div
		class="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-fest-teal bg-fest-dark-teal shadow-2xl"
	>
		<div class="flex flex-col gap-4 overflow-y-auto p-6">
			<div class="flex items-center justify-center">
				<img src={birdLogo} alt="FEST" class="h-16 w-auto" />
			</div>

			<h2 id="welcome-title" class="text-center text-xl font-extrabold text-fest-widget">
				Willkommen!
			</h2>

			<p class="text-center text-sm text-fest-turquoise">
				Dein persönlicher Timetable für das Festival. Hier sind die wichtigsten Funktionen:
			</p>

			<ul class="flex flex-col gap-3">
				<li class="text-sm text-fest-widget">
					<span class="font-bold text-fest-cyan">Favoriten</span> — Tippe auf das Herz, um Acts
					zu speichern, und filtere später nur deine Auswahl.
				</li>
				<li class="text-sm text-fest-widget">
					<span class="font-bold text-fest-cyan">Suche</span> — Finde Künstler:innen und Bühnen
					blitzschnell über das Suchfeld oben.
				</li>
				<li class="text-sm text-fest-widget">
					<span class="font-bold text-fest-cyan">Ansicht</span> — Wechsle zwischen Raster- und
					Listenansicht und erkunde die Festival-Karte.
				</li>
			</ul>

			{#if canInstall}
				<div class="flex flex-col gap-2 rounded-xl border border-fest-teal bg-fest-text/40 p-4">
					<p class="text-sm text-fest-widget">
						<span class="font-bold text-fest-cyan">App installieren</span> — Speichere den
						Timetable auf deinem Startbildschirm für schnellen Zugriff, auch offline.
					</p>
					<button
						class="fest-button rounded-full bg-fest-logo px-4 py-2 text-sm font-bold text-fest-text"
						onclick={oninstall}
					>
						Zum Startbildschirm hinzufügen
					</button>
				</div>
			{/if}

			{#if showIosInstallHint}
				<div class="flex flex-col gap-2 rounded-xl border border-fest-teal bg-fest-text/40 p-4">
					<p class="text-sm text-fest-widget">
						<span class="font-bold text-fest-cyan">App installieren</span> — Tippe unten auf
						<span class="font-bold">Teilen</span> und wähle
						<span class="font-bold">Zum Home-Bildschirm</span>, um den Timetable auf deinem
						Startbildschirm zu speichern.
					</p>
				</div>
			{/if}

			<button
				class="fest-button mt-2 rounded-full bg-fest-blue px-4 py-2 text-sm font-bold text-fest-widget"
				onclick={onclose}
			>
				Los geht's
			</button>
		</div>

		<div
			class="flex items-center justify-center gap-4 border-t border-fest-teal bg-fest-text/40 px-6 py-3 text-xs"
		>
			<a
				href="https://feel-festival.de/impressum"
				target="_blank"
				rel="noopener noreferrer"
				class="text-fest-turquoise hover:text-fest-widget hover:underline"
			>
				Impressum
			</a>
			<span class="text-fest-teal">·</span>
			<a
				href="https://feel-festival.de/datenschutz"
				target="_blank"
				rel="noopener noreferrer"
				class="text-fest-turquoise hover:text-fest-widget hover:underline"
			>
				Datenschutz
			</a>
		</div>
	</div>
</div>
