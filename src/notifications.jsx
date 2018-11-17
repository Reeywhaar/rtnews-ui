import { createElement } from "react";

import { removeNotification } from "./store.jsx";

export default function Notifications(props) {
	return (
		<div className="notifications">
			{props.notifications &&
				props.notifications
					.slice(0)
					.reverse()
					.map(n => (
						<div
							className={
								"notifications__item " +
								(n.level ? `notifications__item-level-${n.level}` : "")
							}
							key={n.id}
						>
							{n.data}
							{n.closable && (
								<div
									role="button"
									className="notifications__close-item"
									onClick={() => removeNotification(n)}
								>
									×︎
								</div>
							)}
						</div>
					))}
		</div>
	);
}
