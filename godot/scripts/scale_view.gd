extends Control
## Draws catalog objects as circles side by side, smallest to largest, at their
## true relative size for the current zoom.
##
## `zoom` is log10 of how much the circle area's height spans (metres or
## seconds). Every pixel size is 10^(log10 size - zoom) × height, computed fresh
## each frame, so there are no world coordinates to lose precision in: the
## viewer works in log space and pixel space only.

signal object_clicked(index: int)
signal zoom_nudged(delta_decades: float)

const Format := preload("res://scripts/format.gd")

## Where the focused object sits: its diameter is this share of the circle area.
const FOCUS_FILL := 0.6
const MAX_DRAW_RADIUS := 20000.0
const LABEL_FONT_SIZE := 14
const VALUE_FONT_SIZE := 12
const LABEL_ROWS := 3

var entries: Array = []
var dimension := "length"
var zoom := 0.0
var focus_index := -1

var _hits: Array = []  # [center: Vector2, radius: float, index: int]


static func focus_zoom_for(lg: float) -> float:
	# The zoom at which an object of size 10^lg fills FOCUS_FILL of the height.
	return lg - log(FOCUS_FILL) / log(10.0)


func _circle_height() -> float:
	return size.y * 0.62


func _baseline() -> float:
	return size.y * 0.70


static func _color_for(entry: Dictionary) -> Color:
	var cats: Array = entry.get("categories", [])
	var key: String = cats[0] if cats.size() > 0 else entry.get("id", "")
	var hue := float(absi(hash(key)) % 360) / 360.0
	return Color.from_hsv(hue, 0.55, 0.95)


## Fractional index into `entries` of the object that fills FOCUS_FILL now.
func anchor_position() -> float:
	var target := zoom + log(FOCUS_FILL) / log(10.0)
	var n := entries.size()
	if n == 0:
		return -1.0
	if target <= entries[0]["log10"]:
		return 0.0
	for i in range(n - 1):
		var a: float = entries[i]["log10"]
		var b: float = entries[i + 1]["log10"]
		if target <= b:
			return i + (0.0 if b == a else (target - a) / (b - a))
	return float(n - 1)


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		match event.button_index:
			MOUSE_BUTTON_WHEEL_UP:
				zoom_nudged.emit(-0.1)
				accept_event()
			MOUSE_BUTTON_WHEEL_DOWN:
				zoom_nudged.emit(0.1)
				accept_event()
			MOUSE_BUTTON_LEFT:
				var best := -1
				var best_r := INF
				for hit in _hits:
					if event.position.distance_to(hit[0]) <= max(hit[1], 6.0) and hit[1] < best_r:
						best = hit[2]
						best_r = hit[1]
				if best >= 0:
					object_clicked.emit(best)
					accept_event()
	elif event is InputEventMagnifyGesture:
		zoom_nudged.emit((1.0 - event.factor) * 2.0)
		accept_event()


func _draw() -> void:
	var w := size.x
	var h := size.y
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.06, 0.07, 0.09))
	_hits.clear()
	var n := entries.size()
	if n == 0:
		return

	var ch := _circle_height()
	var base := _baseline()
	var radii := PackedFloat64Array()
	radii.resize(n)
	for i in n:
		radii[i] = 0.5 * ch * pow(10.0, entries[i]["log10"] - zoom)

	# Lay the row out in pixels, left to right, with a gap proportional to the
	# neighbours, then slide it so the focus point is centred.
	var xs := PackedFloat64Array()
	xs.resize(n)
	xs[0] = 0.0
	for i in range(1, n):
		xs[i] = xs[i - 1] + radii[i - 1] + radii[i] + 0.3 * (radii[i - 1] + radii[i])
	var f := anchor_position()
	var k := int(floor(f))
	var t := f - k
	var focus_x: float = xs[k] if k >= n - 1 else lerpf(xs[k], xs[k + 1], t)
	var shift := w * 0.5 - focus_x

	var font := get_theme_default_font()
	draw_line(Vector2(0, base), Vector2(w, base), Color(1, 1, 1, 0.15), 1.0)

	var visible: Array = []
	for i in n:
		var r := radii[i]
		var cx := xs[i] + shift
		if r < 0.3 or r > MAX_DRAW_RADIUS or cx + r < -50.0 or cx - r > w + 50.0:
			continue
		var center := Vector2(cx, base - maxf(r, 1.0))
		var color := _color_for(entries[i])
		if r < 1.5:
			draw_circle(center, 1.5, Color(color, 0.6))
		else:
			draw_circle(center, r, Color(color, 0.18))
			var segments := clampi(int(r * 0.6), 32, 720)
			var outline := Color.WHITE if i == focus_index else color
			draw_arc(center, r, 0.0, TAU, segments, outline, 3.0 if i == focus_index else 1.5, true)
		_hits.append([center, r, i])
		visible.append(i)

	_draw_labels(visible, radii, xs, shift, base, font)
	_draw_scale_bar(ch, font)


func _draw_labels(visible: Array, radii: PackedFloat64Array, xs: PackedFloat64Array, shift: float, base: float, font: Font) -> void:
	# Biggest circles claim label space first; smaller ones take a lower row or
	# go unlabelled rather than overlap.
	var order := visible.duplicate()
	order.sort_custom(func(a, b): return _label_priority(a, radii) > _label_priority(b, radii))
	var rows: Array = []
	for _r in LABEL_ROWS:
		rows.append([])
	var row_h := 40.0
	for i in order:
		if radii[i] < 2.0 and i != focus_index:
			continue
		var entry: Dictionary = entries[i]
		var name_text: String = entry["name"]
		var value_text := Format.value(entry["log10"], dimension)
		var tw: float = maxf(
			font.get_string_size(name_text, HORIZONTAL_ALIGNMENT_LEFT, -1, LABEL_FONT_SIZE).x,
			font.get_string_size(value_text, HORIZONTAL_ALIGNMENT_LEFT, -1, VALUE_FONT_SIZE).x)
		var cx := clampf(xs[i] + shift, tw * 0.5 + 6.0, size.x - tw * 0.5 - 6.0)
		var span := Vector2(cx - tw * 0.5 - 8.0, cx + tw * 0.5 + 8.0)
		for row in LABEL_ROWS:
			var free := true
			for other in rows[row]:
				if span.x < other.y and other.x < span.y:
					free = false
					break
			if not free:
				continue
			rows[row].append(span)
			var top := base + 14.0 + row * row_h
			var anchor_x := clampf(xs[i] + shift, 0.0, size.x)
			draw_line(Vector2(anchor_x, base + 2.0), Vector2(cx, top - 2.0), Color(1, 1, 1, 0.25), 1.0)
			var strong := Color.WHITE if i == focus_index else Color(1, 1, 1, 0.85)
			draw_string(font, Vector2(cx - tw * 0.5, top + 12.0), name_text, HORIZONTAL_ALIGNMENT_LEFT, -1, LABEL_FONT_SIZE, strong)
			draw_string(font, Vector2(cx - tw * 0.5, top + 27.0), value_text, HORIZONTAL_ALIGNMENT_LEFT, -1, VALUE_FONT_SIZE, Color(0.7, 0.75, 0.8))
			break


func _label_priority(i: int, radii: PackedFloat64Array) -> float:
	return INF if i == focus_index else radii[i]


func _draw_scale_bar(ch: float, font: Font) -> void:
	# A 1, 2 or 5 × 10^n bar of roughly 160 px, so the zoom always has a ruler.
	var lg_target := zoom + log(160.0 / ch) / log(10.0)
	var e := floorf(lg_target)
	var m := pow(10.0, lg_target - e)
	var nice := 5.0 if m >= 5.0 else (2.0 if m >= 2.0 else 1.0)
	var lg := e + log(nice) / log(10.0)
	var px := ch * pow(10.0, lg - zoom)
	var origin := Vector2(20, 28)
	var col := Color(1, 1, 1, 0.8)
	draw_line(origin, origin + Vector2(px, 0), col, 2.0)
	draw_line(origin + Vector2(0, -6), origin + Vector2(0, 6), col, 2.0)
	draw_line(origin + Vector2(px, -6), origin + Vector2(px, 6), col, 2.0)
	draw_string(font, origin + Vector2(0, 24), Format.value(lg, dimension), HORIZONTAL_ALIGNMENT_LEFT, -1, 14, col)
