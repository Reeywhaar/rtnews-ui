import { Notification } from "./notificationInterface";
import { createStore } from "redux";

export interface State {
	issueNumber: number | null;
	isAdmin: boolean;
	notifications: any[];
	activeId: string | null;
	theme: "day" | "night";
}

const initialState: State = {
	issueNumber: null,
	isAdmin: false,
	notifications: [],
	activeId: null,
	theme: "day",
};

export interface StateAction {
	type: "setState";
	state: Partial<State>;
}

export interface NotificationAction {
	type: "addNotification" | "removeNotification";
	notification: any;
}

const rootReducer = (
	state: State = initialState,
	action: StateAction | NotificationAction
): State => {
	switch (action.type) {
		case "setState":
			return { ...state, ...action.state };
		case "addNotification":
			return {
				...state,
				notifications: [...state.notifications, action.notification],
			};
		case "removeNotification":
			const index = state.notifications.indexOf(action.notification);
			if (index < 0) return state;
			return {
				...state,
				notifications: [
					...state.notifications.slice(0, index),
					...state.notifications.slice(index + 1),
				],
			};
		default:
			return state;
	}
};

export const store = createStore(rootReducer);

export function setState(state: Partial<State>): void {
	store.dispatch({
		type: "setState",
		state,
	});
}

let notificationId: number = 0;

type DeferredNotification = (remove: () => void) => Partial<Notification>;

function createNotification(
	notification: string | Partial<Notification>
): Notification {
	if (typeof notification === "string") {
		notification = {
			data: <span dangerouslySetInnerHTML={{ __html: notification }} />,
			time: 3000,
			level: "default",
		};
	} else if (typeof notification.data === "string") {
		notification.data = (
			<span dangerouslySetInnerHTML={{ __html: notification.data }} />
		);
	}
	notification.id = notificationId++;
	notification = Object.assign(
		{
			context: null,
			level: "default",
			time: 3000,
			closable: true,
		},
		notification
	);
	//inject key into react component to avoid misrendering
	(notification.data as JSX.Element).key = notification.id;
	return notification as Notification;
}

export function addNotification(
	notification: DeferredNotification | string | Partial<Notification>
): Notification {
	if (typeof notification === "function") {
		// fuckery with indirection
		const n = {};
		const remover = () => {
			store.dispatch({
				type: "removeNotification",
				notification: n,
			});
		};
		Object.assign(n, createNotification(notification(remover)));
		notification = n;
	} else {
		notification = createNotification(notification);
	}
	store.dispatch({
		type: "addNotification",
		notification,
	});
	if (notification.time !== null) {
		setTimeout(() => {
			store.dispatch({
				type: "removeNotification",
				notification,
			});
		}, notification.time);
	}
	return notification as Notification;
}

export function removeNotification(notification: Notification): void {
	store.dispatch({
		type: "removeNotification",
		notification,
	});
}

export function removeNotificationsWithContext(context: any): void {
	setState({
		notifications: store
			.getState()
			.notifications.filter((n: Notification) => n.context !== context),
	});
}

let themeCounter: number = 0;

export function setTheme(theme: "day" | "night", immediate: boolean = false) {
	setState({ theme });

	if (immediate) {
		document.documentElement.dataset.theme = theme;
		return;
	}

	++themeCounter;
	document.documentElement.classList.add("switch-transition");
	setTimeout(() => {
		document.documentElement.dataset.theme = theme;
		setTimeout(() => {
			--themeCounter;
			if (themeCounter < 1)
				document.documentElement.classList.remove("switch-transition");
		}, 1500);
	}, 10);
}
