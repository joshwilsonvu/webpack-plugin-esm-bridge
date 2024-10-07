if (typeof Promise.withResolvers === "undefined") {
	// biome-ignore lint/complexity/useArrowFunction: <explanation>
	Promise.withResolvers = function <T>() {
		let resolve: (val: T | PromiseLike<T>) => void;
		let reject: (reason: unknown) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		// @ts-expect-error assigned sync
		return { promise, resolve, reject };
	};
}
