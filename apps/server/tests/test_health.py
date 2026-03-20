from conftest import managed_test_client


def test_health() -> None:
    with managed_test_client("anima-health-test-", invalidate_agent=False) as client:
        response = client.get("/health")

        assert response.status_code == 200
        assert response.json() == {
            "status": "ok",
            "service": "server",
            "environment": "development",
            "provisioned": False,
        }


def test_api_health() -> None:
    with managed_test_client("anima-health-test-", invalidate_agent=False) as client:
        response = client.get("/api/health")

        assert response.status_code == 200
        assert response.json() == {
            "status": "ok",
            "service": "server",
            "environment": "development",
            "provisioned": False,
        }


def test_api_health_allows_vite_loopback_preflight() -> None:
    with managed_test_client("anima-health-test-", invalidate_agent=False) as client:
        response = client.options(
            "/api/health",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "GET",
            },
        )

        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
