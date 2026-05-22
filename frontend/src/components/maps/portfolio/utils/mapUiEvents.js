export const overlayEventProps = {
  onClick: (event) => event.stopPropagation(),
  onDoubleClick: (event) => event.stopPropagation(),
  onMouseDown: (event) => event.stopPropagation(),
  onTouchStart: (event) => event.stopPropagation(),
};
