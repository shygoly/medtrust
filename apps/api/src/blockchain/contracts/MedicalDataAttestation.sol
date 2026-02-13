// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title MedicalDataAttestation
 * @dev Smart contract for storing and verifying medical data attestations on FISCO BCOS blockchain
 * Supports SM2/SM3/SM4 national cryptography algorithms
 */
contract MedicalDataAttestation {

    struct AttestationRecord {
        bytes32 dataHash;        // SM3 hash of the attested data
        string dataType;         // Type of data: "patient_record", "consent", "data_sharing"
        address attester;        // Address of the entity that created the attestation
        uint256 timestamp;       // Block timestamp when attestation was created
        string metadata;         // JSON metadata with entity IDs and operation details
        bool exists;             // Flag to check if attestation exists
    }

    // Mapping from data hash to attestation record
    mapping(bytes32 => AttestationRecord) private attestations;

    // Mapping from attestation ID to attestation record
    mapping(uint256 => AttestationRecord) private attestationsById;

    // Mapping from attester address to list of attestation IDs
    mapping(address => uint256[]) private attesterAttestations;

    // Counter for attestation IDs
    uint256 private attestationCounter;

    // Contract owner
    address public owner;

    // Paused state
    bool public paused;

    // Events
    event AttestationStored(
        uint256 indexed attestationId,
        bytes32 indexed dataHash,
        string dataType,
        address indexed attester,
        uint256 timestamp
    );

    event ContractPaused(address indexed by);
    event ContractUnpaused(address indexed by);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Ownable: caller is not the owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    modifier whenPaused() {
        require(paused, "Contract is not paused");
        _;
    }

    constructor() {
        owner = msg.sender;
        paused = false;
        attestationCounter = 0;
    }

    /**
     * @dev Store a new attestation record
     * @param dataHash SM3 hash of the data being attested
     * @param dataType Type of data (e.g., "patient_record", "consent", "data_sharing")
     * @param metadata JSON string with additional metadata
     * @return attestationId The ID of the newly created attestation
     */
    function storeAttestation(
        bytes32 dataHash,
        string memory dataType,
        string memory metadata
    ) public whenNotPaused returns (uint256) {
        require(dataHash != bytes32(0), "Data hash cannot be zero");
        require(bytes(dataType).length > 0, "Data type cannot be empty");
        require(!attestations[dataHash].exists, "Attestation already exists");

        attestationCounter++;
        uint256 attestationId = attestationCounter;

        AttestationRecord memory record = AttestationRecord({
            dataHash: dataHash,
            dataType: dataType,
            attester: msg.sender,
            timestamp: block.timestamp,
            metadata: metadata,
            exists: true
        });

        attestations[dataHash] = record;
        attestationsById[attestationId] = record;
        attesterAttestations[msg.sender].push(attestationId);

        emit AttestationStored(
            attestationId,
            dataHash,
            dataType,
            msg.sender,
            block.timestamp
        );

        return attestationId;
    }

    /**
     * @dev Get attestation record by data hash
     * @param dataHash The SM3 hash to query
     * @return record The attestation record
     */
    function getAttestationByHash(bytes32 dataHash)
        public
        view
        returns (AttestationRecord memory)
    {
        return attestations[dataHash];
    }

    /**
     * @dev Get attestation record by attestation ID
     * @param attestationId The attestation ID to query
     * @return record The attestation record
     */
    function getAttestationById(uint256 attestationId)
        public
        view
        returns (AttestationRecord memory)
    {
        return attestationsById[attestationId];
    }

    /**
     * @dev Verify if an attestation exists for a given data hash
     * @param dataHash The SM3 hash to verify
     * @return exists Whether the attestation exists
     * @return timestamp The timestamp of the attestation (0 if not exists)
     */
    function verifyAttestation(bytes32 dataHash)
        public
        view
        returns (bool exists, uint256 timestamp)
    {
        AttestationRecord memory record = attestations[dataHash];
        return (record.exists, record.timestamp);
    }

    /**
     * @dev Get all attestation IDs created by a specific attester
     * @param attester The address of the attester
     * @return attestationIds Array of attestation IDs
     */
    function getAttestationsByAttester(address attester)
        public
        view
        returns (uint256[] memory)
    {
        return attesterAttestations[attester];
    }

    /**
     * @dev Store multiple attestations in a single transaction
     * @param dataHashes Array of SM3 hashes
     * @param dataTypes Array of data types
     * @param metadatas Array of metadata strings
     * @return attestationIds Array of created attestation IDs
     */
    function storeAttestationBatch(
        bytes32[] memory dataHashes,
        string[] memory dataTypes,
        string[] memory metadatas
    ) public whenNotPaused returns (uint256[] memory) {
        require(
            dataHashes.length == dataTypes.length && dataTypes.length == metadatas.length,
            "Array lengths must match"
        );
        require(dataHashes.length > 0, "Arrays cannot be empty");

        uint256[] memory attestationIds = new uint256[](dataHashes.length);

        for (uint256 i = 0; i < dataHashes.length; i++) {
            attestationIds[i] = storeAttestation(dataHashes[i], dataTypes[i], metadatas[i]);
        }

        return attestationIds;
    }

    /**
     * @dev Pause the contract (only owner)
     */
    function pause() public onlyOwner whenNotPaused {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    /**
     * @dev Unpause the contract (only owner)
     */
    function unpause() public onlyOwner whenPaused {
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    /**
     * @dev Transfer ownership of the contract (only owner)
     * @param newOwner Address of the new owner
     */
    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "New owner cannot be zero address");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /**
     * @dev Get the total number of attestations created
     * @return count Total attestation count
     */
    function getAttestationCount() public view returns (uint256) {
        return attestationCounter;
    }
}
