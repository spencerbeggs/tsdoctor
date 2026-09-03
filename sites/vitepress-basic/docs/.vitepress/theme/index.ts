// The Twoslash hover popups are rendered by @shikijs/vitepress-twoslash as
// floating-vue components; registering its client plugin is the transformer's
// own documented setup, not a component this site authors. The markdown the
// adapter emits stays component-free.
import TwoslashFloatingVue from "@shikijs/vitepress-twoslash/client";
import type { EnhanceAppContext } from "vitepress";
import DefaultTheme from "vitepress/theme";
import "@shikijs/vitepress-twoslash/style.css";

export default {
	extends: DefaultTheme,
	enhanceApp({ app }: EnhanceAppContext) {
		app.use(TwoslashFloatingVue);
	},
};
