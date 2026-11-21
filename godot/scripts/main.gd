extends Control
## The MVP: a log-scale zoom slider along the bottom, the catalog in size order
## on the right, and the objects drawn as circles in between. A mode switch
## flips between lengths and durations; both use the same view.

const Catalog := preload("res://scripts/catalog.gd")
const Format := preload("res://scripts/format.gd")
const ScaleView := preload("res://scripts/scale_view.gd")

const MODES := ["length", "time"]
const MODE_LABELS := ["Length", "Time"]
## Where each mode opens: roughly a person, and roughly a second.
const START_ZOOM := {"length": 0.45, "time": 0.4}
const SMOOTHING := 9.0

var catalog := {}
var mode := "length"
var zoom_current := 0.0
var zoom_target := 0.0
var remembered := {}
var _mode_ready := false

var view: ScaleView
var slider: HSlider
var item_list: ItemList
var readout: Label
var info: Label
var min_label: Label
var max_label: Label
var mode_button: OptionButton


func _ready() -> void:
	catalog = Catalog.load_catalog()
	_build_ui()
	_set_mode("length")


func _build_ui() -> void:
	var root := VBoxContainer.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_theme_constant_override("separation", 0)
	add_child(root)

	# Top bar: title, mode switch, current scale.
	var top := _padded(HBoxContainer.new())
	root.add_child(top.get_parent())
	var title := Label.new()
	title.text = "1024 · Scale viewer"
	title.add_theme_font_size_override("font_size", 18)
	top.add_child(title)
	mode_button = OptionButton.new()
	for label in MODE_LABELS:
		mode_button.add_item(label)
	mode_button.item_selected.connect(func(i): _set_mode(MODES[i]))
	top.add_child(mode_button)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(spacer)
	readout = Label.new()
	top.add_child(readout)

	# Middle: the view, and the list beside it.
	var middle := HBoxContainer.new()
	middle.size_flags_vertical = Control.SIZE_EXPAND_FILL
	middle.add_theme_constant_override("separation", 0)
	root.add_child(middle)

	view = ScaleView.new()
	view.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	view.clip_contents = true
	view.mouse_filter = Control.MOUSE_FILTER_STOP
	view.object_clicked.connect(_focus_object)
	view.zoom_nudged.connect(func(d): zoom_target = clampf(zoom_target + d, slider.min_value, slider.max_value))
	middle.add_child(view)

	var side_panel := PanelContainer.new()
	side_panel.custom_minimum_size = Vector2(340, 0)
	middle.add_child(side_panel)
	var side := _padded(VBoxContainer.new())
	side_panel.add_child(side.get_parent())
	var heading := Label.new()
	heading.text = "Smallest to largest"
	side.add_child(heading)
	item_list = ItemList.new()
	item_list.size_flags_vertical = Control.SIZE_EXPAND_FILL
	item_list.item_selected.connect(_focus_object)
	side.add_child(item_list)
	info = Label.new()
	info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	info.custom_minimum_size = Vector2(300, 150)
	info.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	info.add_theme_font_size_override("font_size", 13)
	side.add_child(info)

	# Bottom: the log-scale slider, labelled with the ends of the catalog.
	var bottom := _padded(HBoxContainer.new())
	root.add_child(bottom.get_parent())
	min_label = Label.new()
	bottom.add_child(min_label)
	slider = HSlider.new()
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	slider.step = 0.001
	slider.custom_minimum_size = Vector2(0, 28)
	slider.value_changed.connect(_on_slider_changed)
	bottom.add_child(slider)
	max_label = Label.new()
	bottom.add_child(max_label)


func _on_slider_changed(v: float) -> void:
	zoom_target = v
	zoom_current = v
	_apply_zoom()


## Wrap a container in a MarginContainer and return the inner container.
func _padded(inner: Container) -> Container:
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 10)
	margin.add_child(inner)
	inner.add_theme_constant_override("separation", 12)
	return inner


func _entries() -> Array:
	return catalog.get(mode, [])


func _set_mode(new_mode: String) -> void:
	if _mode_ready:
		remembered[mode] = zoom_target
	_mode_ready = true
	mode = new_mode
	mode_button.select(MODES.find(mode))
	var entries := _entries()
	view.entries = entries
	view.dimension = mode
	view.focus_index = -1
	item_list.clear()
	for e in entries:
		item_list.add_item("%s   %s" % [e["name"], e["declared"]])
	if entries.is_empty():
		return
	var lo: float = entries[0]["log10"]
	var hi: float = entries[-1]["log10"]
	slider.min_value = floor(lo) - 1.0
	slider.max_value = ceil(ScaleView.focus_zoom_for(hi)) + 1.0
	min_label.text = "10%s" % Format.superscript(int(slider.min_value))
	max_label.text = "10%s %s" % [Format.superscript(int(slider.max_value)), "m" if mode == "length" else "s"]
	zoom_target = remembered.get(mode, START_ZOOM[mode])
	zoom_current = zoom_target
	_apply_zoom()


func _focus_object(index: int) -> void:
	var entries := _entries()
	if index < 0 or index >= entries.size():
		return
	zoom_target = ScaleView.focus_zoom_for(entries[index]["log10"])


func _process(delta: float) -> void:
	if absf(zoom_target - zoom_current) > 0.0005:
		zoom_current = lerpf(zoom_current, zoom_target, 1.0 - exp(-delta * SMOOTHING))
		_apply_zoom()
	elif zoom_current != zoom_target:
		zoom_current = zoom_target
		_apply_zoom()


func _unhandled_input(event: InputEvent) -> void:
	# Keyboard zoom anywhere: +/- or Page Up/Down by a tenth of a decade or a
	# whole one; Home/End jump to the ends; T toggles length/time.
	if not (event is InputEventKey and event.pressed):
		return
	var step := 0.0
	match event.keycode:
		KEY_EQUAL, KEY_KP_ADD: step = -0.1
		KEY_MINUS, KEY_KP_SUBTRACT: step = 0.1
		KEY_PAGEUP: step = -1.0
		KEY_PAGEDOWN: step = 1.0
		KEY_HOME: zoom_target = slider.min_value
		KEY_END: zoom_target = slider.max_value
		KEY_T:
			_set_mode(MODES[(MODES.find(mode) + 1) % MODES.size()])
	if step != 0.0:
		zoom_target = clampf(zoom_target + step, slider.min_value, slider.max_value)


func _apply_zoom() -> void:
	slider.set_value_no_signal(zoom_current)
	view.zoom = zoom_current
	var anchor := int(round(view.anchor_position()))
	if anchor != view.focus_index:
		view.focus_index = anchor
		if anchor >= 0:
			item_list.select(anchor)
			item_list.ensure_current_is_visible()
			_show_info(_entries()[anchor])
	var span := "Screen height ≈ %s" % Format.value(zoom_current + log(1.0 / 0.62) / log(10.0), mode)
	readout.text = "%s    (10^%s)" % [span, String.num(zoom_current, 2)]
	view.queue_redraw()


func _show_info(e: Dictionary) -> void:
	var lines := [e["name"], "%s   (%s)" % [e["declared"], Format.value(e["log10"], mode)]]
	var kind: String = e["approximation"]
	lines.append("Value is %s." % kind)
	if e.has("range_declared"):
		lines.append("Range: %s" % e["range_declared"])
	if not e["source"].is_empty():
		lines.append("Source: %s" % e["source"])
	if not e["note"].is_empty():
		lines.append(e["note"])
	info.text = "\n".join(PackedStringArray(lines))
