#!/usr/bin/env python3
"""Grant the demo consumer access to all six power demo products.

This is intentionally explicit: production must not auto-grant ACLs.
"""

from typing import Dict, Optional

from common import CONSUMER_ID, OPS_EMAIL, OPS_PASSWORD, PRODUCTS, api, login


def main() -> None:
    token = login(OPS_EMAIL, OPS_PASSWORD)
    for product_id, provider_id, _node, _path in PRODUCTS:
        api(
            token,
            "POST",
            "/data-access/grants",
            {
                "dataProductId": product_id,
                "granteeParticipantId": CONSUMER_ID,
                "permissions": ["catalog", "compute"],
                "note": "power demo bootstrap (manual ACL)",
            },
        )
        print("granted %s -> %s" % (product_id, CONSUMER_ID))


if __name__ == "__main__":
    main()
