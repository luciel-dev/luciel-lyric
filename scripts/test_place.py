"""place_box matches static/engine/layers.js for the shared video frame."""
from app.compose import place_box, place_is_cover


def near(a, b, eps=1e-6):
    assert abs(a - b) < eps, (a, b)


def test_exact_cover():
    x, y, w, h = place_box(1080, 1920, 1080, 1920, {"fit": "fill", "scale": 1, "x": 0.5, "y": 0.5})
    near(x, 0)
    near(y, 0)
    near(w, 1080)
    near(h, 1920)
    assert place_is_cover({"fit": "fill", "scale": 1, "x": 0.5, "y": 0.5})


def test_wide_cover_and_fit():
    x, y, w, h = place_box(1920, 1080, 1080, 1920, None)
    near(h, 1920)
    near(w, 1920 * (1920 / 1080))
    near(y, 0)
    assert not place_is_cover({"fit": "fit", "scale": 1, "x": 0.5, "y": 0.5})
    x, y, w, h = place_box(1920, 1080, 1080, 1920, {"fit": "fit", "scale": 1, "x": 0.5, "y": 0.5})
    near(w, 1080)
    near(h, 1080 / (1920 / 1080))
    near(x, 0)
    near(y, (1920 - h) / 2)


if __name__ == "__main__":
    test_exact_cover()
    test_wide_cover_and_fit()
    print("test_place ok")
