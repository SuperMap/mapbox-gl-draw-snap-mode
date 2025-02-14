import MapboxDraw from "@mapbox/mapbox-gl-draw";
import {
  createSnapList,
  getGuideFeature,
  IDS,
  shouldHideGuide,
  snap,
} from "./../utils/index.js";

const { doubleClickZoom } = MapboxDraw.lib;
const { geojsonTypes, cursors } = MapboxDraw.constants;
const DrawPoint = MapboxDraw.modes.draw_point;
const SnapPointMode = { ...DrawPoint };

SnapPointMode.onSetup = function (options) {
  const point = this.newFeature({
    type: geojsonTypes.FEATURE,
    properties: {},
    geometry: {
      type: geojsonTypes.POINT,
      coordinates: [], //(MultiPoint的数据结构才是：[[]])这里修改为与DrawPoint.onSetup中相同的值，DrawPoint.onStop中会根据coordinates.length判断是否删除该要素
    },
  });

  const verticalGuide = this.newFeature(getGuideFeature(IDS.VERTICAL_GUIDE));
  const horizontalGuide = this.newFeature(
    getGuideFeature(IDS.HORIZONTAL_GUIDE)
  );

  this.addFeature(point);
  this.addFeature(verticalGuide);
  this.addFeature(horizontalGuide);

  const selectedFeatures = this.getSelected();
  this.clearSelectedFeatures();
  doubleClickZoom.disable(this);

  const [snapList, vertices] = createSnapList(
    this.map,
    this._ctx.api,
    point,
    this._ctx.options.snapOptions?.snapGetFeatures
  );

  const state = {
    map: this.map,
    point,
    vertices,
    snapList,
    selectedFeatures,
    verticalGuide,
    horizontalGuide,
  };

  state.options = this._ctx.options;

  const moveendCallback = () => {
    const [snapList, vertices] = createSnapList(
      this.map,
      this._ctx.api,
      point,
      this._ctx.options.snapOptions?.snapGetFeatures
    );
    state.vertices = vertices;
    state.snapList = snapList;
  };
  // for removing listener later on close
  state["moveendCallback"] = moveendCallback;

  const optionsChangedCallback = (options) => {
    state.options = options;
  };
  // for removing listener later on close
  state["optionsChangedCallback"] = optionsChangedCallback;

  this.map.on("moveend", moveendCallback);
  this.map.on("draw.snap.options_changed", optionsChangedCallback);

  return state;
};

// [bug] 解决MS中的连续绘制，很快速的点击地图进行绘制时报错的问题（仅enhance包会有此问题）：Uncaught TypeError: Cannot read properties of undefined (reading 'data')
SnapPointMode.onClick = function (state, e) {
  // We mock out e with the rounded lng/lat then call DrawPoint with it
  DrawPoint.onClick.call(this, state, {
    lngLat: {
      lng: state.snappedLng ?? e.lngLat.lng,
      lat: state.snappedLat ?? e.lngLat.lat,
    },
  });
};

SnapPointMode.onMouseMove = function (state, e) {
  const { lng, lat } = snap(state, e);

  state.snappedLng = lng;
  state.snappedLat = lat;

  if (
    state.lastVertex &&
    state.lastVertex[0] === lng &&
    state.lastVertex[1] === lat
  ) {
    this.updateUIClasses({ mouse: cursors.POINTER });

    // cursor options:
    // ADD: "add"
    // DRAG: "drag"
    // MOVE: "move"
    // NONE: "none"
    // POINTER: "pointer"
  } else {
    this.updateUIClasses({ mouse: cursors.ADD });
  }
};

// This is 'extending' DrawPoint.toDisplayFeatures
SnapPointMode.toDisplayFeatures = function (state, geojson, display) {
  if (shouldHideGuide(state, geojson)) return;

  // This relies on the the state of SnapPointMode having a 'point' prop
  DrawPoint.toDisplayFeatures(state, geojson, display);
};

// This is 'extending' DrawPoint.onStop
SnapPointMode.onStop = function (state) {
  this.deleteFeature(IDS.VERTICAL_GUIDE, { silent: true });
  this.deleteFeature(IDS.HORIZONTAL_GUIDE, { silent: true });

  // remove moveend callback
  this.map.off("moveend", state.moveendCallback);

  // This relies on the the state of SnapPointMode having a 'point' prop
  DrawPoint.onStop.call(this, state);
};

export default SnapPointMode;
