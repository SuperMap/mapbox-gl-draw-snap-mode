import MapboxDraw from "@mapbox/mapbox-gl-draw";
import {
  addPointTovertices,
  createSnapList,
  getGuideFeature,
  IDS,
  shouldHideGuide,
  snap,
} from "./../utils";

const { doubleClickZoom } = MapboxDraw.lib;
const DrawPoint = MapboxDraw.modes.draw_point;
const { geojsonTypes, cursors } = MapboxDraw.constants;

const SnapPointMode = { ...DrawPoint };

SnapPointMode.onSetup = function (options) {
  const feature = this.newFeature({
    type: geojsonTypes.FEATURE,
    properties: {},
    geometry: {
      type: geojsonTypes.POINT,
      coordinates: [[]],
    },
  });

  const verticalGuide = this.newFeature(getGuideFeature(IDS.VERTICAL_GUIDE));
  const horizontalGuide = this.newFeature(
    getGuideFeature(IDS.HORIZONTAL_GUIDE)
  );

  this.addFeature(feature);
  this.addFeature(verticalGuide);
  this.addFeature(horizontalGuide);

  const selectedFeatures = this.getSelected();
  this.clearSelectedFeatures();
  doubleClickZoom.disable(this);

  // const [snapList, vertices] = createSnapList(this.map, this._ctx.api, point);
  let layers = this.map.getStyle().layers;
  const targetLayers = layers.filter(layerInfo => {
    const { type, source } = layerInfo;
    if ((source !== 'mapbox-gl-draw-cold' && source !== 'mapbox-gl-draw-hot') && (type === 'circle' || type === 'line' || type === 'fill')) {
      return true;
    };
  });
  let targetLayersId = targetLayers.map((layerInfo) => {
    return layerInfo.id;
  });
  const state = {
    map: this.map,
    feature,
    point: feature,
    prevQueryBbox: null,
    targetLayersId,
    // vertices,
    // snapList,
    selectedFeatures,
    verticalGuide,
    horizontalGuide,
  };

  state.options = this._ctx.options;
  const draw = this._ctx.api;

  const updateSnapList = () => {
    const [snapList, vertices] = createSnapList(this.map, draw, point);
    state.vertices = vertices;
    state.snapList = snapList;
  };
  // for removing listener later on close
  state["updateSnapList"] = updateSnapList;
  Object.assign(draw, { updateSnapList });
  const optionsChangedCallBAck = (options) => {
    state.options = options;
  };
  // for removing listener later on close
  state["optionsChangedCallBAck"] = optionsChangedCallBAck;

  // this.map.on("moveend", moveendCallback);
  this.map.on("draw.snap.options_changed", optionsChangedCallBAck);

  return state;
};

SnapPointMode.onClick = function (state) {
  // We mock out e with the rounded lng/lat then call DrawPoint with it
  DrawPoint.onClick.call(this, state, {
    lngLat: {
      lng: state.snappedLng,
      lat: state.snappedLat,
    },
  });
};

SnapPointMode.onMouseMove = function (state, e) {
  state.halfSize = ((state.options.snapOptions && state.options.snapOptions.cacheSize) || 100) / 2;
  const halfCacheSize = state.halfSize - 15;
  const { x, y } = e.point;
  if (!state.prevQueryBbox || (state.prevQueryBbox && !(state.prevQueryBbox[0] < x && state.prevQueryBbox[2] > x && state.prevQueryBbox[1] < y && state.prevQueryBbox[3] > y))) {
    const [snapList, vertices] = createSnapList(state, this._ctx.api, e);

    state.snapList = snapList;

    state.vertices = vertices;

    state.prevQueryBbox = [
      x - halfCacheSize,
      y - halfCacheSize,
      x + halfCacheSize,
      y + halfCacheSize
    ]
  }
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

  // remove moveemd callback
  // this.map.off("moveend", state.moveendCallback);

  // This relies on the the state of SnapPointMode having a 'point' prop
  DrawPoint.onStop.call(this, state);
};

export default SnapPointMode;
