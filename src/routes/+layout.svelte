<script>
	// Root layout component that imports global styles
	import '../app.css';
	let { children } = $props();
</script>

{@render children()}
