from flask import Flask, request, jsonify
import subprocess
import json
import os
import tempfile
import uuid

app = Flask(__name__)

SPDZ_PATH = "/opt/MP-SPDZ"
PROTOCOL = os.getenv("SPDZ_PROTOCOL", "shamir")

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy", "protocol": PROTOCOL})

@app.route('/compute/sum', methods=['POST'])
def compute_sum():
    """
    Compute secure sum of shares
    Expected payload: {
        "session_id": "uuid",
        "shares": [{"party_id": 0, "value": 100}, {"party_id": 1, "value": 150}]
    }
    """
    try:
        data = request.json
        session_id = data.get('session_id')
        shares = data.get('shares', [])

        if not session_id or not shares:
            return jsonify({"error": "Missing session_id or shares"}), 400

        # Create temporary directory for this computation
        with tempfile.TemporaryDirectory() as tmpdir:
            # Write shares to files
            for share in shares:
                party_id = share['party_id']
                value = share['value']
                with open(f"{tmpdir}/Input-P{party_id}-0", 'w') as f:
                    f.write(str(value))

            # Run MP-SPDZ computation
            result = subprocess.run(
                [f"{SPDZ_PATH}/Scripts/{PROTOCOL}.sh", "sum", str(len(shares))],
                cwd=tmpdir,
                capture_output=True,
                timeout=60
            )

            if result.returncode != 0:
                return jsonify({"error": "Computation failed", "details": result.stderr.decode()}), 500

            # Parse result
            output = result.stdout.decode()
            # Extract sum from output (format depends on MP-SPDZ output)
            sum_value = parse_spdz_output(output)

            return jsonify({
                "session_id": session_id,
                "result": sum_value,
                "computation": "sum"
            })

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Computation timeout"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/compute/mean', methods=['POST'])
def compute_mean():
    """
    Compute secure mean of shares
    Expected payload: {
        "session_id": "uuid",
        "shares": [{"party_id": 0, "value": 0.75}, {"party_id": 1, "value": 0.82}]
    }
    """
    try:
        data = request.json
        session_id = data.get('session_id')
        shares = data.get('shares', [])

        if not session_id or not shares:
            return jsonify({"error": "Missing session_id or shares"}), 400

        # Create temporary directory for this computation
        with tempfile.TemporaryDirectory() as tmpdir:
            # Write shares to files
            for share in shares:
                party_id = share['party_id']
                value = share['value']
                with open(f"{tmpdir}/Input-P{party_id}-0", 'w') as f:
                    f.write(str(value))

            # Run MP-SPDZ computation
            result = subprocess.run(
                [f"{SPDZ_PATH}/Scripts/{PROTOCOL}.sh", "mean", str(len(shares))],
                cwd=tmpdir,
                capture_output=True,
                timeout=60
            )

            if result.returncode != 0:
                return jsonify({"error": "Computation failed", "details": result.stderr.decode()}), 500

            # Parse result
            output = result.stdout.decode()
            mean_value = parse_spdz_output(output)

            return jsonify({
                "session_id": session_id,
                "result": mean_value,
                "computation": "mean"
            })

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Computation timeout"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def parse_spdz_output(output):
    """Parse MP-SPDZ output to extract result"""
    # This is a simplified parser - actual implementation depends on MP-SPDZ output format
    lines = output.strip().split('\n')
    for line in lines:
        if 'Result:' in line:
            return float(line.split('Result:')[1].strip())
    # Fallback: try to find last number in output
    import re
    numbers = re.findall(r'-?\d+\.?\d*', output)
    if numbers:
        return float(numbers[-1])
    return None

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
